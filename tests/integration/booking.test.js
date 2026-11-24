// Booking workflow tests: availability, double-booking prevention, status
// transitions, cancellation rules, rescheduling and reviews.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, createTestDatabase, expectError, firstFreeSlot, hasDatabase, IDS, setSetting } from './db/helpers.js'

const book = (c, args) =>
  c
    .query(
      `select create_booking($1, $2::uuid[], $3::timestamptz, $4::location_type, $5, $6, $7, $8::payment_provider) as r`,
      [
        args.service,
        args.options || [],
        args.start,
        args.location || 'stylist_studio',
        args.address || null,
        args.notes || null,
        args.promo || null,
        args.provider || null,
      ],
    )
    .then((r) => r.rows[0].r)

describe.skipIf(!hasDatabase)('Booking workflow', () => {
  let db
  beforeAll(async () => {
    db = await createTestDatabase()
    // These tests create many bookings quickly; raise the rate limit (tested separately below).
    await setSetting(db.pool, 'max_bookings_per_hour', 1000)
  }, 60_000)
  afterAll(async () => db?.drop())

  describe('availability', () => {
    it('offers slots only inside working hours, respecting notice and breaks', async () => {
      const { rows } = await db.pool.query(
        `select s.slot_start, s.slot_end,
                to_char(s.slot_start at time zone 'America/Moncton', 'HH24:MI') as local_start,
                to_char(s.slot_end at time zone 'America/Moncton', 'HH24:MI') as local_end
         from generate_series(current_date + 2, current_date + 9, interval '1 day') d,
              lateral get_available_slots($1, d::date) s`,
        [IDS.cornrows],
      )
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        // Stylist 1 works 09:00–19:00 local time; a 90-minute service must fit inside.
        expect(r.local_start >= '09:00' && r.local_end <= '19:00').toBe(true)
      }
      const tooSoon = await db.pool.query(`select count(*)::int n from get_available_slots($1, current_date)
                                          where slot_start < now() + interval '12 hours'`, [IDS.cornrows])
      expect(tooSoon.rows[0].n).toBe(0)
    })

    it('does not offer slots during time off', async () => {
      const slot = await firstFreeSlot(db.pool, IDS.cornrows)
      const day = await db.pool.query(`select ($1::timestamptz at time zone 'America/Moncton')::date as d`, [slot])
      await db.pool.query(
        `insert into availability_exceptions (stylist_id, starts_at, ends_at, reason)
         values ($1, $2::timestamptz - interval '1 hour', $2::timestamptz + interval '1 day', 'test holiday')`,
        [IDS.stylist1, slot],
      )
      const { rows } = await db.pool.query(
        `select count(*)::int n from get_available_slots($1, $2::date) where slot_start >= $3`,
        [IDS.cornrows, day.rows[0].d, slot],
      )
      expect(rows[0].n).toBe(0)
      await db.pool.query(`delete from availability_exceptions where reason = 'test holiday'`)
    })
  })

  describe('creating bookings', () => {
    it('instant-booking service is confirmed immediately (pay in person)', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows)
      const r = await as(db.pool, IDS.client2, (c) => book(c, { service: IDS.cornrows, start }))
      expect(r.status).toBe('confirmed')
      expect(r.requires_online_payment).toBe(false)
      expect(r.payment_provider).toBe('pay_in_person')
    })

    it('approval-mode stylist receives a request', async () => {
      const start = await firstFreeSlot(db.pool, IDS.silkPress)
      const r = await as(db.pool, IDS.client2, (c) => book(c, { service: IDS.silkPress, start, location: 'salon' }))
      expect(r.status).toBe('requested')
    })

    it('stores a server-calculated price, ignoring anything the browser might claim', async () => {
      const start = await firstFreeSlot(db.pool, IDS.knotless, [IDS.optMidBack, IDS.optCurly])
      const b = await as(db.pool, IDS.client2, async (c) => {
        const r = await book(c, { service: IDS.knotless, start, options: [IDS.optMidBack, IDS.optCurly] })
        return (await c.query('select * from bookings where id = $1', [r.booking_id])).rows[0]
      })
      // 180 + 30 (mid-back) + 15 (curly ends) = 225.00; fee 5% = 11.25
      expect(b.subtotal_cents).toBe(22500)
      expect(b.service_fee_cents).toBe(1125)
      expect(b.total_cents).toBe(23625)
      expect(b.duration_minutes).toBe(300 + 60 + 30)
      expect(b.platform_commission_cents).toBe(3375) // 15% of 225.00
    })

    it('rejects a missing "choose one" option and options from other services', async () => {
      const start = await firstFreeSlot(db.pool, IDS.knotless, [IDS.optShoulder])
      await expectError(
        as(db.pool, IDS.client2, (c) => book(c, { service: IDS.knotless, start })),
        /Please choose one option for "Length"/,
      )
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          book(c, { service: IDS.cornrows, start, options: [IDS.optShoulder] }),
        ),
        /not available/,
      )
    })

    it('rejects a time that is not an available slot', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows)
      const odd = new Date(new Date(start).getTime() + 7 * 60 * 1000).toISOString()
      await expectError(
        as(db.pool, IDS.client2, (c) => book(c, { service: IDS.cornrows, start: odd })),
        /no longer available/,
      )
    })

    it('rejects a location type the service does not offer', async () => {
      const start = await firstFreeSlot(db.pool, IDS.silkPress)
      await expectError(
        as(db.pool, IDS.client2, (c) => book(c, { service: IDS.silkPress, start, location: 'stylist_studio' })),
        /does not offer that appointment location/,
      )
    })

    it('mobile booking requires the client’s own saved address and adds a travel fee', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows)
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          book(c, { service: IDS.cornrows, start, location: 'client_location', address: IDS.client1Address }),
        ),
        /saved addresses/,
      )
      const b = await as(db.pool, IDS.client1, async (c) => {
        const r = await book(c, { service: IDS.cornrows, start, location: 'client_location', address: IDS.client1Address })
        return (await c.query('select * from bookings where id = $1', [r.booking_id])).rows[0]
      })
      expect(b.travel_fee_cents).toBeGreaterThan(1000) // base fee $10 + per-km
      expect(Number(b.distance_km)).toBeGreaterThan(0)
    })

    it('stylists cannot book themselves', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows)
      await expectError(
        as(db.pool, IDS.stylist1, (c) => book(c, { service: IDS.cornrows, start })),
        /cannot book your own/,
      )
    })

    it('rate-limits booking spam', async () => {
      await setSetting(db.pool, 'max_bookings_per_hour', 1)
      await db.pool.query(`insert into rate_limit_events (user_id, action) values ($1, 'create_booking')`, [IDS.admin])
      const start = await firstFreeSlot(db.pool, IDS.cornrows)
      await expectError(as(db.pool, IDS.admin, (c) => book(c, { service: IDS.cornrows, start })), /Too many requests/)
      await setSetting(db.pool, 'max_bookings_per_hour', 1000)
    })
  })

  describe('double-booking prevention', () => {
    it('the second booking for the same slot is rejected', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 6)
      await as(db.pool, IDS.client1, (c) => book(c, { service: IDS.cornrows, start }), { commit: true })
      await expectError(
        as(db.pool, IDS.client2, (c) => book(c, { service: IDS.cornrows, start })),
        /no longer available|just booked/,
      )
    })

    it('two simultaneous requests for one slot: exactly one succeeds', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 8)
      const attempt = (who) =>
        as(db.pool, who, (c) => book(c, { service: IDS.cornrows, start }), { commit: true }).then(
          () => 'ok',
          (e) => e.message,
        )
      const results = await Promise.all([attempt(IDS.client1), attempt(IDS.client2)])
      expect(results.filter((r) => r === 'ok')).toHaveLength(1)
      expect(results.find((r) => r !== 'ok')).toMatch(/just booked|no longer available/)
    })

    it('the database constraint blocks overlaps even for direct inserts', async () => {
      const { rows } = await db.pool.query(
        `select starts_at, ends_at from bookings where stylist_id = $1 and status = 'confirmed' limit 1`,
        [IDS.stylist1],
      )
      await expectError(
        db.pool.query(
          `insert into bookings (client_id, stylist_id, stylist_service_id, status, booking_mode, location_type,
             starts_at, ends_at, blocked_until, duration_minutes, subtotal_cents, total_cents, payment_provider)
           values ($1, $2, $3, 'confirmed', 'instant', 'stylist_studio', $4, $5, $5, 30, 100, 100, 'pay_in_person')`,
          [IDS.client2, IDS.stylist1, IDS.cornrows, rows[0].starts_at, rows[0].ends_at],
        ),
        /no_double_booking/,
      )
    })

    it('the buffer time after an appointment is respected', async () => {
      const { rows } = await db.pool.query(
        `select b.ends_at from bookings b where b.stylist_id = $1 and b.status = 'confirmed' order by starts_at limit 1`,
        [IDS.stylist1],
      )
      const overlapping = await db.pool.query(
        `select count(*)::int n from get_available_slots($1, ($2::timestamptz at time zone 'America/Moncton')::date)
         where slot_start >= $2 and slot_start < $2::timestamptz + interval '15 minutes'`,
        [IDS.cornrows, rows[0].ends_at],
      )
      expect(overlapping.rows[0].n).toBe(0)
    })
  })

  describe('status transitions', () => {
    it('stylist accepts a request; client cannot', async () => {
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          c.query(`select transition_booking($1, 'confirmed')`, [IDS.requestedBooking]),
        ),
        /Only the stylist/,
      )
      const r = await as(db.pool, IDS.stylist3, (c) =>
        c.query(`select transition_booking($1, 'confirmed') as r`, [IDS.requestedBooking]),
      )
      expect(r.rows[0].r.status).toBe('confirmed')
    })

    it('other stylists cannot touch the booking', async () => {
      await expectError(
        as(db.pool, IDS.stylist1, (c) => c.query(`select transition_booking($1, 'confirmed')`, [IDS.requestedBooking])),
        /Booking not found/,
      )
    })

    it('invalid jumps are rejected (requested -> completed)', async () => {
      await expectError(
        as(db.pool, IDS.stylist3, (c) => c.query(`select transition_booking($1, 'completed')`, [IDS.requestedBooking])),
        /cannot change from requested to completed/,
      )
    })

    it('cannot start an appointment days early', async () => {
      await expectError(
        as(db.pool, IDS.stylist2, (c) => c.query(`select transition_booking($1, 'in_progress')`, [IDS.confirmedBooking])),
        /one hour before/,
      )
    })

    it('full lifecycle: confirmed -> in progress -> completed, with history', async () => {
      await db.pool.query(
        `update bookings set starts_at = now() + interval '30 minutes', ends_at = now() + interval '150 minutes',
                blocked_until = now() + interval '165 minutes' where id = $1`,
        [IDS.confirmedBooking],
      )
      await as(
        db.pool,
        IDS.stylist2,
        async (c) => {
          await c.query(`select transition_booking($1, 'in_progress')`, [IDS.confirmedBooking])
          await c.query(`select transition_booking($1, 'completed')`, [IDS.confirmedBooking])
        },
        { commit: true },
      )
      const hist = await db.pool.query(
        `select to_status from booking_status_history where booking_id = $1 order by id`,
        [IDS.confirmedBooking],
      )
      expect(hist.rows.map((h) => h.to_status)).toEqual(['confirmed', 'in_progress', 'completed'])
      const notif = await db.pool.query(
        `select count(*)::int n from notifications where user_id = $1 and type = 'booking_completed'
           and data ->> 'booking_id' = $2`,
        [IDS.client1, IDS.confirmedBooking],
      )
      expect(notif.rows[0].n).toBe(1)
    })
  })

  describe('cancellation', () => {
    it('client cancels early: full refund amount, no fee', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 10)
      const out = await as(db.pool, IDS.client2, async (c) => {
        const r = await book(c, { service: IDS.cornrows, start })
        const preview = (await c.query(`select cancellation_preview($1) p`, [r.booking_id])).rows[0].p
        const cancel = (await c.query(`select cancel_booking($1, 'Change of plans') r`, [r.booking_id])).rows[0].r
        return { preview, cancel }
      })
      expect(out.preview.fee_cents).toBe(0)
      expect(out.cancel.status).toBe('cancelled_by_client')
    })

    it('a cancelled booking frees the slot again', async () => {
      const start = await firstFreeSlot(db.pool, IDS.cornrows, [], 12)
      await as(db.pool, IDS.client2, async (c) => {
        const r = await book(c, { service: IDS.cornrows, start })
        await c.query(`select cancel_booking($1)`, [r.booking_id])
        const again = await book(c, { service: IDS.cornrows, start })
        expect(again.status).toBe('confirmed')
      })
    })

    it('completed bookings cannot be cancelled', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select cancel_booking($1)`, [IDS.completedBooking])),
        /can no longer be cancelled/,
      )
    })

    it('outsiders cannot cancel', async () => {
      await expectError(
        as(db.pool, IDS.client2, (c) => c.query(`select cancel_booking($1)`, [IDS.completedBooking])),
        /Booking not found/,
      )
    })
  })

  describe('rescheduling', () => {
    it('moves a booking to another free slot and blocks the old one no longer', async () => {
      const first = await firstFreeSlot(db.pool, IDS.cornrows, [], 14)
      await as(db.pool, IDS.client2, async (c) => {
        const r = await book(c, { service: IDS.cornrows, start: first })
        const { rows } = await c.query(
          `select slot_start from get_available_slots($1, ($2::timestamptz at time zone 'America/Moncton')::date + 1)
           order by slot_start limit 1`,
          [IDS.cornrows, first],
        )
        const moved = (await c.query(`select reschedule_booking($1, $2) r`, [r.booking_id, rows[0].slot_start])).rows[0].r
        expect(moved.status).toBe('confirmed') // instant-booking stylist: stays confirmed
        const freed = await c.query(
          `select count(*)::int n from get_available_slots($1, ($2::timestamptz at time zone 'America/Moncton')::date)
           where slot_start = $2`,
          [IDS.cornrows, first],
        )
        expect(freed.rows[0].n).toBe(1)
      })
    })
  })

  describe('reviews', () => {
    it('only the client of a completed booking can review it, once', async () => {
      // The seeded completed booking already has a review.
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`insert into reviews (booking_id, client_id, rating) values ($1, $2, 4)`, [
            IDS.completedBooking,
            IDS.client1,
          ]),
        ),
        /row-level security/,
      )
      // Booking completed in the lifecycle test above (client1) can be reviewed.
      const r = await as(db.pool, IDS.client1, (c) =>
        c.query(`insert into reviews (booking_id, client_id, rating, comment) values ($1, $2, 4, 'Great') returning stylist_id`, [
          IDS.confirmedBooking,
          IDS.client1,
        ]),
      )
      expect(r.rows[0].stylist_id).toBe(IDS.stylist2)
    })

    it('other users and non-completed bookings cannot be reviewed', async () => {
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          c.query(`insert into reviews (booking_id, client_id, rating) values ($1, $2, 1)`, [
            IDS.confirmedBooking,
            IDS.client2,
          ]),
        ),
        /row-level security/,
      )
      await expectError(
        as(db.pool, IDS.client2, (c) =>
          c.query(`insert into reviews (booking_id, client_id, rating) values ($1, $2, 5)`, [
            IDS.requestedBooking,
            IDS.client2,
          ]),
        ),
        /row-level security/,
      )
    })

    it('reviews outside the review window are refused', async () => {
      await db.pool.query(`update bookings set completed_at = now() - interval '60 days' where id = $1`, [
        IDS.confirmedBooking,
      ])
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`insert into reviews (booking_id, client_id, rating) values ($1, $2, 4)`, [
            IDS.confirmedBooking,
            IDS.client1,
          ]),
        ),
        /row-level security/,
      )
      await db.pool.query(`update bookings set completed_at = now() where id = $1`, [IDS.confirmedBooking])
    })

    it('stylists can reply but cannot edit the rating', async () => {
      const { rows } = await db.pool.query(`select id from reviews where booking_id = $1`, [IDS.completedBooking])
      await as(db.pool, IDS.stylist1, (c) => c.query(`select reply_to_review($1, 'Thank you!')`, [rows[0].id]), {
        commit: true,
      })
      const reply = await db.pool.query(`select stylist_reply from reviews where id = $1`, [rows[0].id])
      expect(reply.rows[0].stylist_reply).toBe('Thank you!')
      await expectError(
        as(db.pool, IDS.client2, (c) => c.query(`select reply_to_review($1, 'Not mine')`, [rows[0].id])),
        /Review not found/,
      )
      const r = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`update reviews set rating = 1 where id = $1 returning id`, [rows[0].id]),
      )
      expect(r.rows.length).toBe(0) // RLS: only the author can update
    })
  })

  describe('search', () => {
    it('finds stylists by category, location and mode', async () => {
      const r = await as(db.pool, 'anon', (c) =>
        c.query(
          `select stylist_id, distance_km from search_stylists(p_category_slug => 'braids', p_lat => 45.96, p_lng => -66.64,
             p_radius_km => 30)`,
        ),
      )
      expect(r.rows.map((x) => x.stylist_id)).toContain(IDS.stylist1)
      const mobile = await as(db.pool, 'anon', (c) =>
        c.query(`select stylist_id from search_stylists(p_location_mode => 'mobile', p_lat => 45.96, p_lng => -66.64)`),
      )
      expect(mobile.rows.map((x) => x.stylist_id)).not.toContain(IDS.stylist2) // salon-only
      const far = await as(db.pool, 'anon', (c) =>
        c.query(`select stylist_id from search_stylists(p_lat => 43.65, p_lng => -79.38, p_radius_km => 50)`),
      )
      expect(far.rows.length).toBe(0) // nobody public in Toronto
    })

    it('text search and price filters work', async () => {
      const r = await as(db.pool, 'anon', (c) =>
        c.query(`select stylist_id, from_price_cents from search_stylists(p_query => 'silk', p_max_price_cents => 10000)`),
      )
      expect(r.rows.map((x) => x.stylist_id)).toEqual([IDS.stylist2])
    })
  })
})
