// Deno tests for PaymentIntent creation and refund processing, using fake
// Stripe and database objects (no network).  Run:  npm run test:functions
import { deepStrictEqual as assertEquals, rejects } from 'node:assert/strict'
const assertRejects = (fn: () => Promise<unknown>, _cls?: unknown, msg?: string) =>
  rejects(fn, (err: Error) => (msg ? err.message.includes(msg) : true))
import { createOrReusePaymentIntent, type PreparedPayment } from '../_shared/payment-intent.ts'
import { processPendingRefunds } from '../_shared/refunds.ts'

const prep = (over: Partial<PreparedPayment> = {}): PreparedPayment => ({
  payment_id: 'pay-1',
  booking_id: 'book-1',
  booking_reference: 'ABC12345',
  amount_cents: 4725,
  currency: 'cad',
  kind: 'deposit',
  idempotency_key: 'idem-1',
  stripe_payment_intent_id: null,
  client_id: 'client-1',
  ...over,
})

function fakeStripe(existing?: Record<string, unknown>) {
  const created: { params: any; opts: any }[] = []
  return {
    created,
    paymentIntents: {
      async create(params: any, opts: any) {
        created.push({ params, opts })
        return { id: 'pi_new', client_secret: 'pi_new_secret', status: 'requires_payment_method', amount: params.amount }
      },
      async retrieve(_id: string) {
        return existing
      },
    },
  } as any
}

Deno.test('creates a PaymentIntent for the server amount with an idempotency key', async () => {
  const stripe = fakeStripe()
  const attached: string[] = []
  const r = await createOrReusePaymentIntent(stripe, prep(), async (p, i) => {
    attached.push(`${p}:${i}`)
  })
  assertEquals(r.clientSecret, 'pi_new_secret')
  assertEquals(stripe.created[0].params.amount, 4725)
  assertEquals(stripe.created[0].params.currency, 'cad')
  assertEquals(stripe.created[0].params.metadata.booking_id, 'book-1')
  assertEquals(stripe.created[0].opts.idempotencyKey, 'pi-idem-1')
  assertEquals(attached, ['pay-1:pi_new'])
})

Deno.test('re-uses an unpaid PaymentIntent instead of creating a second one', async () => {
  const stripe = fakeStripe({ id: 'pi_old', status: 'requires_payment_method', amount: 4725, client_secret: 'old_secret' })
  const r = await createOrReusePaymentIntent(stripe, prep({ stripe_payment_intent_id: 'pi_old' }), async () => {})
  assertEquals(r.reused, true)
  assertEquals(r.clientSecret, 'old_secret')
  assertEquals(stripe.created.length, 0)
})

Deno.test('refuses to start another payment when the intent already succeeded', async () => {
  const stripe = fakeStripe({ id: 'pi_old', status: 'succeeded', amount: 4725, client_secret: 's' })
  await assertRejects(
    () => createOrReusePaymentIntent(stripe, prep({ stripe_payment_intent_id: 'pi_old' }), async () => {}),
    Error,
    'already been completed',
  )
})

function fakeAdmin(rows: unknown[]) {
  const rpcCalls: { fn: string; args: any }[] = []
  return {
    rpcCalls,
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args })
      if (fn === 'svc_pending_stripe_refunds') return { data: rows, error: null }
      return { data: { action: 'recorded' }, error: null }
    },
    from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
  } as any
}

Deno.test('refunds are sent to Stripe with a per-refund idempotency key and recorded', async () => {
  const admin = fakeAdmin([
    { refund_id: 'r1', booking_id: 'b1', amount_cents: 3150, payment_intent_id: 'pi_1', reason: 'late cancel' },
  ])
  const sent: any[] = []
  const stripe = {
    refunds: {
      async create(params: any, opts: any) {
        sent.push({ params, opts })
        return { id: 're_1', status: 'succeeded' }
      },
    },
  } as any
  const res = await processPendingRefunds(admin, stripe, 'b1')
  assertEquals(res, { attempted: 1, succeeded: 1, failed: 0, errors: [] })
  assertEquals(sent[0].params.amount, 3150)
  assertEquals(sent[0].params.payment_intent, 'pi_1')
  assertEquals(sent[0].opts.idempotencyKey, 'refund-r1')
  const record = admin.rpcCalls.find((c: any) => c.fn === 'svc_record_refund')
  assertEquals(record.args, { p_refund_id: 'r1', p_stripe_refund_id: 're_1', p_status: 'succeeded', p_failure: null })
})

Deno.test('a Stripe error marks the refund failed so an admin can retry', async () => {
  const admin = fakeAdmin([{ refund_id: 'r2', booking_id: 'b2', amount_cents: 100, payment_intent_id: 'pi_2', reason: '' }])
  const stripe = {
    refunds: {
      async create() {
        throw new Error('charge_already_refunded')
      },
    },
  } as any
  const res = await processPendingRefunds(admin, stripe, 'b2')
  assertEquals(res.failed, 1)
  const record = admin.rpcCalls.find((c: any) => c.fn === 'svc_record_refund')
  assertEquals(record.args.p_status, 'failed')
  assertEquals(record.args.p_failure, 'charge_already_refunded')
})
