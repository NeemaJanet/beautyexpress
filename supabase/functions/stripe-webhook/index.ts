// POST /functions/v1/stripe-webhook   (called by Stripe, not by the browser)
//
// 1. Verifies the Stripe signature (rejects anything not signed by Stripe).
// 2. Ignores events already processed (idempotency).
// 3. Updates payments, refunds, payouts and Connect accounts in the database.
//
// Deploy with:  supabase functions deploy stripe-webhook --no-verify-jwt
// (Stripe cannot send a Supabase JWT; the Stripe signature is the security check.)
import { processPendingRefunds } from '../_shared/refunds.ts'
import { cryptoProvider, stripeClient } from '../_shared/stripe.ts'
import { adminClient } from '../_shared/supabase.ts'
import { type EventStore, handleStripeEvent } from '../_shared/webhook-handler.ts'

const text = (body: string, status: number) => new Response(body, { status })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Method not allowed', 405)

  const signature = req.headers.get('stripe-signature')
  if (!signature) return text('Missing signature', 400)
  const secrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(
    (s): s is string => Boolean(s),
  )
  if (secrets.length === 0) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return text('Webhook not configured', 503)
  }

  const payload = await req.text() // raw body is required for signature checks
  const stripe = stripeClient()
  let event
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, cryptoProvider)
      break
    } catch {
      // try the next secret
    }
  }
  if (!event) return text('Invalid signature', 400)

  const admin = adminClient()
  const store: EventStore = {
    async claim(e) {
      const { data } = await admin.from('stripe_events').select('processed_at').eq('id', e.id).maybeSingle()
      if (data?.processed_at) return 'duplicate'
      if (!data) {
        const { error } = await admin
          .from('stripe_events')
          .insert({ id: e.id, type: e.type, payload: event })
        if (error && error.code !== '23505') throw error
      }
      return 'new'
    },
    async markProcessed(id) {
      await admin.from('stripe_events').update({ processed_at: new Date().toISOString(), last_error: null }).eq('id', id)
    },
    async markFailed(id, message) {
      await admin.from('stripe_events').update({ last_error: message.slice(0, 1000) }).eq('id', id)
    },
  }

  try {
    const result = await handleStripeEvent(event as never, {
      store,
      rpc: async (fn, args) => {
        const { data, error } = await admin.rpc(fn, args)
        if (error) throw new Error(`${fn}: ${error.message}`)
        return data as Record<string, unknown> | null
      },
      onRefundQueued: async (bookingId) => {
        await processPendingRefunds(admin, stripe, bookingId)
      },
    })
    return new Response(JSON.stringify({ received: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Webhook processing failed', err)
    // 500 makes Stripe retry later.
    return text('Processing failed', 500)
  }
})
