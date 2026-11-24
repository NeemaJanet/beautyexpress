// Payment state machine tests. Stripe itself is not called here: these tests
// drive the same database functions the Edge Functions call after Stripe
// responds, so they verify idempotency, refunds, payouts and permissions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, createTestDatabase, expectError, firstFreeSlot, hasDatabase, IDS, setSetting } from './db/helpers.js'

async function bookOnline(db, who, service, opts = {}) {
  const start = await firstFreeSlot(db.pool, service, opts.options || [], opts.daysAhead || 3)
  return as(
    db.pool,
    who,
    async (c) =>
      (
        await c.query(
          `select create_booking($1, $2::uuid[], $3, $4::location_type, null, null, null, 'stripe') r`,
          [service, opts.options || [], start, opts.location || 'stylist_studio'],
        )
      ).rows[0].r,
    { commit: true },
  )
}

const svc = (db, sql, params) => as(db.pool, 'service_role', (c) => c.query(sql, params), { commit: true })

async function payBooking(db, who, bookingId, intent) {
  const prep = await as(db.pool, who, async (c) => (await c.query(`select prepare_payment($1) p`, [bookingId])).rows[0].p, {
    commit: true,
  })
  await svc(db, `select svc_attach_payment_intent($1, $2)`, [prep.payment_id, intent])
  const res = await svc(db, `select svc_record_payment_succeeded($1, $2, $3) r`, [intent, `ch_${intent}`, prep.amount_cents])
  return { prep, result: res.rows[0].r }
}

describe.skipIf(!hasDatabase)('Payments, refunds and payouts', () => {
  let db
  beforeAll(async () => {
    db = await createTestDatabase()
    await setSetting(db.pool, 'online_payments_enabled', true)
    await setSetting(db.pool, 'manual_etransfer_enabled', true)
    await setSetting(db.pool, 'max_bookings_per_hour', 1000)
  }, 60_000)
  afterAll(async () => db?.drop())

  it('online booking holds the slot as pending_payment until paid', async () => {
    const r = await bookOnline(db, IDS.client2, IDS.cornrows)
    expect(r.status).toBe('pending_payment')
    expect(r.requires_online_payment).toBe(true)
    expect(r.amount_due_now_cents).toBe(6300) // $60 + 5% fee, no deposit rule => full amount
  })

  it('prepare_payment computes the amount on the server and only for the booking’s client', async () => {
    const r = await bookOnline(db, IDS.client2, IDS.cornrows, { daysAhead: 4 })
    await expectError(
      as(db.pool, IDS.client1, (c) => c.query(`select prepare_payment($1)`, [r.booking_id])),
      /Booking not found/,
    )
    const p1 = await as(db.pool, IDS.client2, async (c) => (await c.query(`select prepare_payment($1) p`, [r.booking_id])).rows[0].p, {
      commit: true,
    })
    const p2 = await as(db.pool, IDS.client2, async (c) => (await c.query(`select prepare_payment($1) p`, [r.booking_id])).rows[0].p, {
      commit: true,
    })
    expect(p1.amount_cents).toBe(6300)
    expect(p2.payment_id).toBe(p1.payment_id) // re-used: no duplicate payment records
    expect(p2.idempotency_key).toBe(p1.idempotency_key)
  })

  it('a deposit rule charges only the deposit up front', async () => {
    const r = await bookOnline(db, IDS.client2, IDS.knotless, { options: [IDS.optShoulder], daysAhead: 5 })
    // 180.00 + 5% fee = 189.00; 25% deposit = 47.25
    expect(r.amount_due_now_cents).toBe(4725)
  })

  it('successful payment confirms the booking; a duplicate webhook does nothing', async () => {
    const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 6 })
    const { result } = await payBooking(db, IDS.client1, r.booking_id, 'pi_dup_test')
    expect(result.action).toBe('booking_confirmed') // stylist 1 uses instant booking
    const again = await svc(db, `select svc_record_payment_succeeded('pi_dup_test', 'ch_pi_dup_test', 6300) r`)
    expect(again.rows[0].r.action).toBe('already_recorded')
    const b = await db.pool.query(`select status, amount_paid_cents from bookings where id = $1`, [r.booking_id])
    expect(b.rows[0]).toEqual({ status: 'confirmed', amount_paid_cents: 6300 }) // counted once
  })

  it('payment failure is recorded and the booking stays pending', async () => {
    const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 7 })
    const prep = await as(db.pool, IDS.client1, async (c) => (await c.query(`select prepare_payment($1) p`, [r.booking_id])).rows[0].p, {
      commit: true,
    })
    await svc(db, `select svc_attach_payment_intent($1, 'pi_fail_1')`, [prep.payment_id])
    await svc(db, `select svc_record_payment_failed('pi_fail_1', 'failed', 'Card declined')`)
    const p = await db.pool.query(`select status, failure_reason from payments where id = $1`, [prep.payment_id])
    expect(p.rows[0]).toEqual({ status: 'failed', failure_reason: 'Card declined' })
    const b = await db.pool.query(`select status from bookings where id = $1`, [r.booking_id])
    expect(b.rows[0].status).toBe('pending_payment')
  })

  it('an unpaid hold expires and the slot is released', async () => {
    const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 8 })
    await db.pool.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [r.booking_id])
    const n = await db.pool.query(`select expire_stale_holds() n`)
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1)
    const b = await db.pool.query(`select status from bookings where id = $1`, [r.booking_id])
    expect(b.rows[0].status).toBe('expired')
    await expectError(
      as(db.pool, IDS.client1, (c) => c.query(`select prepare_payment($1)`, [r.booking_id])),
      /nothing to pay|expired/,
    )
  })

  it('a late payment after expiry revives the booking if the slot is still free', async () => {
    const r = await bookOnline(db, IDS.client2, IDS.cornrows, { daysAhead: 9 })
    const prep = await as(db.pool, IDS.client2, async (c) => (await c.query(`select prepare_payment($1) p`, [r.booking_id])).rows[0].p, {
      commit: true,
    })
    await svc(db, `select svc_attach_payment_intent($1, 'pi_late_1')`, [prep.payment_id])
    await db.pool.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [r.booking_id])
    await db.pool.query(`select expire_stale_holds()`)
    // expire_stale_holds cancelled the open payment record; Stripe still reports success.
    await db.pool.query(`update payments set status = 'processing' where id = $1`, [prep.payment_id])
    const res = await svc(db, `select svc_record_payment_succeeded('pi_late_1', 'ch_late_1', $1) r`, [prep.amount_cents])
    expect(res.rows[0].r.action).toBe('booking_confirmed')
  })

  describe('cancellations and refunds', () => {
    it('stylist cancellation queues a full refund; Stripe success applies it exactly once', async () => {
      const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 10 })
      await payBooking(db, IDS.client1, r.booking_id, 'pi_refund_1')
      const cancel = await as(db.pool, IDS.stylist1, async (c) => (await c.query(`select cancel_booking($1, 'Sick') r`, [r.booking_id])).rows[0].r, {
        commit: true,
      })
      expect(cancel.status).toBe('cancelled_by_stylist')
      expect(cancel.refund_queued_cents).toBe(6300)

      const pending = await svc(db, `select * from svc_pending_stripe_refunds($1)`, [r.booking_id])
      expect(pending.rows).toHaveLength(1)
      const refundId = pending.rows[0].refund_id
      await svc(db, `select svc_record_refund($1, 're_1', 'succeeded')`, [refundId])
      await svc(db, `select svc_record_refund(null, 're_1', 'succeeded')`) // duplicate webhook
      const b = await db.pool.query(`select amount_refunded_cents from bookings where id = $1`, [r.booking_id])
      expect(b.rows[0].amount_refunded_cents).toBe(6300)
      const p = await db.pool.query(`select status, amount_refunded_cents from payments where stripe_payment_intent_id = 'pi_refund_1'`)
      expect(p.rows[0]).toEqual({ status: 'refunded', amount_refunded_cents: 6300 })
    })

    it('late client cancellation keeps the late fee', async () => {
      const r = await bookOnline(db, IDS.client2, IDS.cornrows, { daysAhead: 11 })
      await payBooking(db, IDS.client2, r.booking_id, 'pi_late_cancel')
      // Move the appointment to 2 hours from now (inside the 24 h window).
      await db.pool.query(
        `update bookings set starts_at = now() + interval '2 hours', ends_at = now() + interval '210 minutes',
           blocked_until = now() + interval '225 minutes' where id = $1`,
        [r.booking_id],
      )
      const cancel = await as(db.pool, IDS.client2, async (c) => (await c.query(`select cancel_booking($1) r`, [r.booking_id])).rows[0].r, {
        commit: true,
      })
      expect(cancel.fee_cents).toBe(3150) // 50% of 63.00
      expect(cancel.refund_queued_cents).toBe(3150)
    })

    it('declining a paid request refunds in full', async () => {
      const r = await bookOnline(db, IDS.client2, IDS.silkPress, { daysAhead: 3, location: 'salon' })
      // silk press: 95.00 + 5% = 99.75; fixed $25 deposit
      expect(r.amount_due_now_cents).toBe(2500)
      const { result } = await payBooking(db, IDS.client2, r.booking_id, 'pi_decline')
      expect(result.action).toBe('booking_requested')
      const d = await as(db.pool, IDS.stylist2, async (c) => (await c.query(`select transition_booking($1, 'declined', 'Fully booked') r`, [r.booking_id])).rows[0].r, {
        commit: true,
      })
      expect(d.refund_queued_cents).toBe(2500)
    })

    it('a refund can never exceed what was paid', async () => {
      const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 12 })
      await payBooking(db, IDS.client1, r.booking_id, 'pi_cap')
      const queued = await db.pool.query(`select queue_refunds($1, 999999, 'test') n`, [r.booking_id])
      expect(queued.rows[0].n).toBe(6300)
      const again = await db.pool.query(`select queue_refunds($1, 100, 'test') n`, [r.booking_id])
      expect(again.rows[0].n).toBe(0) // already fully reserved by the pending refund
    })
  })

  describe('payouts', () => {
    it('completed bookings are paid out once, after the hold period, minus platform fees', async () => {
      const r = await bookOnline(db, IDS.client1, IDS.cornrows, { daysAhead: 13 })
      await payBooking(db, IDS.client1, r.booking_id, 'pi_payout')
      await db.pool.query(
        `update bookings set status = 'completed', completed_at = now() - interval '2 days' where id = $1`,
        [r.booking_id],
      )
      // No connected account yet: nothing to pay.
      let claim = await svc(db, `select * from svc_claim_payouts(50)`)
      expect(claim.rows.find((x) => x.booking_id === r.booking_id)).toBeUndefined()

      await svc(db, `select svc_set_stripe_account($1, 'acct_test_1')`, [IDS.stylist1])
      await svc(db, `select svc_update_connect_account('acct_test_1', true, true, true)`)
      claim = await svc(db, `select * from svc_claim_payouts(50)`)
      const row = claim.rows.find((x) => x.booking_id === r.booking_id)
      // 63.00 collected - 9.00 commission (15% of 60) - 3.00 booking fee = 51.00
      expect(row.amount_cents).toBe(5100)
      expect(row.source_charge_id).toBe('ch_pi_payout')

      await svc(db, `select svc_record_payout($1, 'tr_1', 'transferred')`, [row.payout_id])
      claim = await svc(db, `select * from svc_claim_payouts(50)`)
      expect(claim.rows.find((x) => x.booking_id === r.booking_id)).toBeUndefined()
      const count = await db.pool.query(`select count(*)::int n from payouts where booking_id = $1`, [r.booking_id])
      expect(count.rows[0].n).toBe(1)
    })

    it('an open dispute blocks the payout', async () => {
      const r = await bookOnline(db, IDS.client2, IDS.cornrows, { daysAhead: 14 })
      await payBooking(db, IDS.client2, r.booking_id, 'pi_dispute')
      await db.pool.query(
        `update bookings set status = 'completed', completed_at = now() - interval '2 days' where id = $1`,
        [r.booking_id],
      )
      await as(
        db.pool,
        IDS.client2,
        (c) => c.query(`select open_dispute($1, 'Not as described', 'The style was not what was agreed.')`, [r.booking_id]),
        { commit: true },
      )
      const claim = await svc(db, `select * from svc_claim_payouts(50)`)
      expect(claim.rows.find((x) => x.booking_id === r.booking_id)).toBeUndefined()

      // Admin resolves with a partial refund.
      const { rows } = await db.pool.query(`select id from disputes where booking_id = $1`, [r.booking_id])
      const res = await as(
        db.pool,
        IDS.admin,
        async (c) => (await c.query(`select admin_update_dispute($1, 'resolved_refund', 'Partial refund', 2000) r`, [rows[0].id])).rows[0].r,
        { commit: true },
      )
      expect(res.refund_queued_cents).toBe(2000)
      await expectError(
        as(db.pool, IDS.client2, (c) => c.query(`select admin_update_dispute($1, 'closed')`, [rows[0].id])),
        /Administrator access required/,
      )
    })

    it('stylists see only their own payouts', async () => {
      const own = await as(db.pool, IDS.stylist1, (c) => c.query(`select stylist_id from payouts`))
      expect(own.rows.every((p) => p.stylist_id === IDS.stylist1)).toBe(true)
      const other = await as(db.pool, IDS.stylist2, (c) => c.query(`select * from payouts where stylist_id = $1`, [IDS.stylist1]))
      expect(other.rows).toHaveLength(0)
    })
  })

  describe('manual e-Transfer', () => {
    it('client marks sent, admin verifies; nobody else can verify', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 15)
      const r = await as(
        db.pool,
        IDS.client2,
        async (c) =>
          (await c.query(`select create_booking($1, '{}', $2, 'stylist_studio', null, null, null, 'manual_etransfer') r`, [
            IDS.cornrows,
            start,
          ])).rows[0].r,
        { commit: true },
      )
      expect(r.status).toBe('confirmed') // not held: e-Transfer is verified later
      const pay = await db.pool.query(`select id, reference_code from payments where booking_id = $1`, [r.booking_id])
      expect(pay.rows[0].reference_code).toMatch(/^HN-/)
      await as(db.pool, IDS.client2, (c) => c.query(`select mark_etransfer_sent($1)`, [pay.rows[0].id]), { commit: true })
      await expectError(
        as(db.pool, IDS.stylist1, (c) => c.query(`select admin_verify_manual_payment($1, true)`, [pay.rows[0].id])),
        /Administrator access required/,
      )
      await as(db.pool, IDS.admin, (c) => c.query(`select admin_verify_manual_payment($1, true, 'Matched')`, [pay.rows[0].id]), {
        commit: true,
      })
      const after = await db.pool.query(`select p.status, b.amount_paid_cents from payments p join bookings b on b.id = p.booking_id where p.id = $1`, [pay.rows[0].id])
      expect(after.rows[0]).toEqual({ status: 'succeeded', amount_paid_cents: 6300 })
    })

    it('disabled payment methods are refused', async () => {
      await setSetting(db.pool, 'manual_etransfer_enabled', false)
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 16)
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          c.query(`select create_booking($1, '{}', $2, 'stylist_studio', null, null, null, 'manual_etransfer')`, [IDS.cornrows, start]),
        ),
        /payment method is not available/,
      )
    })
  })

  describe('pay in person', () => {
    it('only the stylist can mark it paid, after confirmation', async () => {
      const { rows } = await db.pool.query(
        `select id from payments where booking_id = $1`,
        ['b0000000-0000-4000-8000-000000000003'], // requested (not yet confirmed)
      )
      await expectError(
        as(db.pool, IDS.stylist3, (c) => c.query(`select stylist_mark_paid_in_person($1)`, [rows[0].id])),
        /must be confirmed/,
      )
      await expectError(
        as(db.pool, IDS.client2, (c) => c.query(`select stylist_mark_paid_in_person($1)`, [rows[0].id])),
        /Payment not found/,
      )
    })
  })
})
