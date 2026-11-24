// Stripe client for Edge Functions (Deno uses the fetch-based HTTP client).
import Stripe from 'npm:stripe@23.0.0'
import { requireEnv } from './http.ts'

export { Stripe }

let cached: Stripe | null = null

export function stripeClient(): Stripe {
  if (!cached) {
    cached = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
      httpClient: Stripe.createFetchHttpClient(),
      appInfo: { name: 'BeautyExpress', version: '0.1.0' },
    })
  }
  return cached
}

/** Web Crypto provider required to verify webhook signatures in Deno. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider()

export function isLiveKey(): boolean {
  return (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_live_')
}
