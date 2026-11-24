/**
 * Stripe.js loader. Only the PUBLISHABLE key (pk_test_... / pk_live_...) is
 * used in the browser. Card details are entered into Stripe's own secure
 * fields and never touch BeautyExpress's servers or database.
 */
import { loadStripe } from '@stripe/stripe-js'

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

export const isStripeConfigured = Boolean(publishableKey)
export const isStripeTestMode = !publishableKey || publishableKey.startsWith('pk_test_')

let stripePromise = null
export function getStripe() {
  if (!isStripeConfigured) return null
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

export const stripeAppearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#5a3a26',
    colorBackground: '#ffffff',
    colorText: '#2b211c',
    colorDanger: '#a23b2a',
    fontFamily: 'DM Sans, system-ui, sans-serif',
    borderRadius: '10px',
  },
}
