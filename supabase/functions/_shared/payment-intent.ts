// Creates (or safely re-uses) a Stripe PaymentIntent for a payment record
// prepared by the database function prepare_payment().
import type Stripe from 'npm:stripe@23.0.0'

export interface PreparedPayment {
  payment_id: string
  booking_id: string
  booking_reference: string
  amount_cents: number
  currency: string
  kind: 'full' | 'deposit' | 'balance'
  idempotency_key: string
  stripe_payment_intent_id: string | null
  client_id: string
}

export async function createOrReusePaymentIntent(
  stripe: Pick<Stripe, 'paymentIntents'>,
  prep: PreparedPayment,
  attachIntent: (paymentId: string, intentId: string) => Promise<void>,
): Promise<{ clientSecret: string; paymentIntentId: string; reused: boolean }> {
  // Re-use the existing intent if it can still be paid. This prevents a second
  // charge when the client refreshes the checkout page.
  if (prep.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(prep.stripe_payment_intent_id)
    const reusable = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing']
    if (reusable.includes(existing.status) && existing.amount === prep.amount_cents && existing.client_secret) {
      return { clientSecret: existing.client_secret, paymentIntentId: existing.id, reused: true }
    }
    if (existing.status === 'succeeded') {
      throw new Error('This payment has already been completed.')
    }
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: prep.amount_cents, // from the database, never from the browser
      currency: prep.currency,
      automatic_payment_methods: { enabled: true },
      description: `BeautyExpress booking ${prep.booking_reference} (${prep.kind})`,
      // Groups the charge with the later transfer to the stylist.
      transfer_group: `booking_${prep.booking_id}`,
      metadata: {
        payment_id: prep.payment_id,
        booking_id: prep.booking_id,
        client_id: prep.client_id,
        kind: prep.kind,
      },
    },
    // Same payment record => same key => Stripe returns the same intent.
    { idempotencyKey: `pi-${prep.idempotency_key}` },
  )
  await attachIntent(prep.payment_id, intent.id)
  if (!intent.client_secret) throw new Error('Stripe did not return a client secret')
  return { clientSecret: intent.client_secret, paymentIntentId: intent.id, reused: false }
}
