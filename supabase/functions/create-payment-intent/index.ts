// POST /functions/v1/create-payment-intent   { booking_id }
//
// Returns a Stripe client secret for the amount the DATABASE says is due.
// The browser never sends an amount.
import { fromDbError, handler, HttpError, json, requireUuid } from '../_shared/http.ts'
import { createOrReusePaymentIntent, type PreparedPayment } from '../_shared/payment-intent.ts'
import { stripeClient } from '../_shared/stripe.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

Deno.serve(
  handler(async (req, body) => {
    const bookingId = requireUuid(body.booking_id, 'booking_id')
    const { client } = await requireUser(req)

    // Runs as the user: the function checks they are the booking's client.
    const { data, error } = await client.rpc('prepare_payment', { p_booking_id: bookingId })
    if (error) throw fromDbError(error)
    const prep = data as PreparedPayment

    const admin = adminClient()
    try {
      const result = await createOrReusePaymentIntent(stripeClient(), prep, async (paymentId, intentId) => {
        const { error: attachErr } = await admin.rpc('svc_attach_payment_intent', {
          p_payment_id: paymentId,
          p_intent_id: intentId,
        })
        if (attachErr) throw attachErr
      })
      return json(req, {
        client_secret: result.clientSecret,
        payment_intent_id: result.paymentIntentId,
        amount_cents: prep.amount_cents,
        currency: prep.currency,
        kind: prep.kind,
      })
    } catch (err) {
      if (err instanceof HttpError) throw err
      const message = err instanceof Error ? err.message : String(err)
      console.error('create-payment-intent failed', message)
      throw new HttpError(502, 'Could not start the payment. Please try again.')
    }
  }),
)
