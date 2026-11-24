// Deno tests for the Stripe webhook logic.  Run:  npm run test:functions
import { deepStrictEqual as assertEquals, rejects } from 'node:assert/strict'
const assertRejects = (fn: () => Promise<unknown>, _cls?: unknown, msg?: string) =>
  rejects(fn, (err: Error) => (msg ? err.message.includes(msg) : true))
import Stripe from 'npm:stripe@23.0.0'
import { type EventStore, handleStripeEvent } from '../_shared/webhook-handler.ts'

const stripe = new Stripe('sk_test_dummy', { httpClient: Stripe.createFetchHttpClient() })
const crypto = Stripe.createSubtleCryptoProvider()
const SECRET = 'whsec_test_secret'

function memoryStore(): EventStore & { processed: Set<string>; failed: Map<string, string> } {
  const processed = new Set<string>()
  const failed = new Map<string, string>()
  return {
    processed,
    failed,
    async claim(e) {
      return processed.has(e.id) ? 'duplicate' : 'new'
    },
    async markProcessed(id) {
      processed.add(id)
    },
    async markFailed(id, message) {
      failed.set(id, message)
    },
  }
}

function recorder(responses: Record<string, Record<string, unknown>> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return responses[fn] ?? { action: 'recorded' }
    },
  }
}

const piSucceeded = (id = 'evt_1') => ({
  id,
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_123', amount: 6300, amount_received: 6300, latest_charge: 'ch_123' } },
})

Deno.test('signature: a correctly signed payload is accepted', async () => {
  const payload = JSON.stringify(piSucceeded())
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET, cryptoProvider: crypto })
  const event = await stripe.webhooks.constructEventAsync(payload, header, SECRET, undefined, crypto)
  assertEquals(event.id, 'evt_1')
})

Deno.test('signature: a tampered payload is rejected', async () => {
  const payload = JSON.stringify(piSucceeded())
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET, cryptoProvider: crypto })
  const tampered = payload.replace('6300', '1')
  await assertRejects(() => stripe.webhooks.constructEventAsync(tampered, header, SECRET, undefined, crypto))
})

Deno.test('signature: the wrong secret is rejected', async () => {
  const payload = JSON.stringify(piSucceeded())
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'whsec_other', cryptoProvider: crypto })
  await assertRejects(() => stripe.webhooks.constructEventAsync(payload, header, SECRET, undefined, crypto))
})

Deno.test('signature: an old timestamp is rejected (replay protection)', async () => {
  const payload = JSON.stringify(piSucceeded())
  const header = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: SECRET,
    cryptoProvider: crypto,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  })
  await assertRejects(() => stripe.webhooks.constructEventAsync(payload, header, SECRET, 300, crypto))
})

Deno.test('payment_intent.succeeded records the payment with the charge id and amount', async () => {
  const store = memoryStore()
  const db = recorder()
  const res = await handleStripeEvent(piSucceeded(), { rpc: db.rpc, store })
  assertEquals(res.status, 'processed')
  assertEquals(db.calls, [
    { fn: 'svc_record_payment_succeeded', args: { p_intent_id: 'pi_123', p_charge_id: 'ch_123', p_amount_cents: 6300 } },
  ])
})

Deno.test('duplicate events are processed only once', async () => {
  const store = memoryStore()
  const db = recorder()
  await handleStripeEvent(piSucceeded('evt_dup'), { rpc: db.rpc, store })
  const second = await handleStripeEvent(piSucceeded('evt_dup'), { rpc: db.rpc, store })
  assertEquals(second.status, 'duplicate')
  assertEquals(db.calls.length, 1)
})

Deno.test('a failed handler is not marked processed, so Stripe can retry', async () => {
  const store = memoryStore()
  const failing = async () => {
    throw new Error('db down')
  }
  await assertRejects(() => handleStripeEvent(piSucceeded('evt_fail'), { rpc: failing, store }))
  assertEquals(store.processed.has('evt_fail'), false)
  assertEquals(store.failed.get('evt_fail'), 'db down')
  // The retry succeeds.
  const db = recorder()
  const retry = await handleStripeEvent(piSucceeded('evt_fail'), { rpc: db.rpc, store })
  assertEquals(retry.status, 'processed')
})

Deno.test('late payment for a released slot triggers immediate refund processing', async () => {
  const store = memoryStore()
  const db = recorder({ svc_record_payment_succeeded: { action: 'refund_queued', booking_id: 'b1' } })
  const refunded: string[] = []
  await handleStripeEvent(piSucceeded('evt_late'), {
    rpc: db.rpc,
    store,
    onRefundQueued: async (id) => {
      refunded.push(id)
    },
  })
  assertEquals(refunded, ['b1'])
})

Deno.test('payment failures, cancellations and refunds map to the right database calls', async () => {
  const store = memoryStore()
  const db = recorder()
  await handleStripeEvent(
    {
      id: 'evt_f',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_f', last_payment_error: { message: 'Card declined' } } },
    },
    { rpc: db.rpc, store },
  )
  await handleStripeEvent(
    { id: 'evt_c', type: 'payment_intent.canceled', data: { object: { id: 'pi_c', cancellation_reason: 'abandoned' } } },
    { rpc: db.rpc, store },
  )
  await handleStripeEvent(
    {
      id: 'evt_r',
      type: 'refund.updated',
      data: { object: { id: 're_1', status: 'succeeded', metadata: { refund_id: 'r-uuid' } } },
    },
    { rpc: db.rpc, store },
  )
  await handleStripeEvent(
    { id: 'evt_rp', type: 'refund.created', data: { object: { id: 're_2', status: 'pending', metadata: {} } } },
    { rpc: db.rpc, store },
  )
  assertEquals(db.calls[0], {
    fn: 'svc_record_payment_failed',
    args: { p_intent_id: 'pi_f', p_status: 'failed', p_reason: 'Card declined' },
  })
  assertEquals(db.calls[1].args.p_status, 'canceled')
  assertEquals(db.calls[2], {
    fn: 'svc_record_refund',
    args: { p_refund_id: 'r-uuid', p_stripe_refund_id: 're_1', p_status: 'succeeded', p_failure: null },
  })
  assertEquals(db.calls[3].args.p_status, 'processing')
  assertEquals(db.calls[3].args.p_refund_id, null)
})

Deno.test('Connect account updates are stored', async () => {
  const db = recorder()
  await handleStripeEvent(
    {
      id: 'evt_acct',
      type: 'account.updated',
      data: { object: { id: 'acct_1', details_submitted: true, charges_enabled: false, payouts_enabled: true } },
    },
    { rpc: db.rpc, store: memoryStore() },
  )
  assertEquals(db.calls[0], {
    fn: 'svc_update_connect_account',
    args: { p_account_id: 'acct_1', p_details_submitted: true, p_charges_enabled: false, p_payouts_enabled: true },
  })
})

Deno.test('unhandled event types are ignored without touching the database', async () => {
  const db = recorder()
  const res = await handleStripeEvent(
    { id: 'evt_x', type: 'customer.created', data: { object: {} } },
    { rpc: db.rpc, store: memoryStore() },
  )
  assertEquals(res.status, 'ignored')
  assertEquals(db.calls.length, 0)
})
