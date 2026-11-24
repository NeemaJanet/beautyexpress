import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { useEffect, useState } from 'react'
import { formatMoney } from '../../lib/pricing.js'
import { getStripe, isStripeConfigured, isStripeTestMode, stripeAppearance } from '../../lib/stripe.js'
import { createPaymentIntent } from '../../services/paymentService.js'
import { Button } from '../common/Button.jsx'
import { FormError } from '../common/Field.jsx'
import { LoadingState } from '../common/States.jsx'

/**
 * Card payment with Stripe's Payment Element. The amount comes from the
 * server; the browser only confirms the payment Stripe created. The booking
 * becomes confirmed when Stripe's webhook reaches the server (a few seconds).
 */
export function PaymentPanel({ bookingId, onPaid }) {
  const [intent, setIntent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isStripeConfigured) return
    let cancelled = false
    createPaymentIntent(bookingId)
      .then((r) => !cancelled && setIntent(r))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [bookingId])

  if (!isStripeConfigured) {
    return (
      <FormError error="Online payment is not configured on this site yet (missing Stripe publishable key). Please contact support." />
    )
  }
  if (error) return <FormError error={error} />
  if (!intent) return <LoadingState label="Preparing secure payment…" className="py-8" />

  return (
    <Elements stripe={getStripe()} options={{ clientSecret: intent.client_secret, appearance: stripeAppearance }}>
      <CheckoutForm intent={intent} bookingId={bookingId} onPaid={onPaid} />
    </Elements>
  )
}

function CheckoutForm({ intent, bookingId, onPaid }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pay = async (e) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/bookings/${bookingId}?paid=1` },
      redirect: 'if_required',
    })
    setBusy(false)
    if (stripeError) {
      setError(stripeError.message)
      return
    }
    if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) onPaid?.(paymentIntent.status)
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      {isStripeTestMode && (
        <p className="rounded-[var(--radius-control)] bg-info-soft px-3 py-2 text-sm text-info">
          Test mode: use card 4242 4242 4242 4242, any future date and any CVC. No real money moves.
        </p>
      )}
      <PaymentElement />
      <FormError error={error} />
      <Button type="submit" variant="accent" size="lg" className="w-full" loading={busy} disabled={!stripe}>
        Pay {formatMoney(intent.amount_cents, intent.currency)}
      </Button>
      <p className="text-center text-xs text-stone">Payments are processed securely by Stripe. We never see your card number.</p>
    </form>
  )
}
