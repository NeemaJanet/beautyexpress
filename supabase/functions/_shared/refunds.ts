// Sends pending refunds to Stripe. Used after cancellations, declines and
// dispute resolutions, and by the scheduled clean-up job.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import type Stripe from 'npm:stripe@23.0.0'

export interface RefundRunResult {
  attempted: number
  succeeded: number
  failed: number
  errors: string[]
}

type RefundRow = {
  refund_id: string
  booking_id: string
  amount_cents: number
  payment_intent_id: string
  reason: string
}

export async function processPendingRefunds(
  admin: SupabaseClient,
  stripe: Pick<Stripe, 'refunds'>,
  bookingId: string | null,
  limit = 25,
): Promise<RefundRunResult> {
  const result: RefundRunResult = { attempted: 0, succeeded: 0, failed: 0, errors: [] }
  const { data, error } = await admin.rpc('svc_pending_stripe_refunds', { p_booking_id: bookingId, p_limit: limit })
  if (error) throw error

  for (const row of (data ?? []) as RefundRow[]) {
    result.attempted++
    // Mark as processing first so a parallel run does not pick it up again.
    await admin.from('refunds').update({ status: 'processing' }).eq('id', row.refund_id).eq('status', 'pending')
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: row.payment_intent_id,
          amount: row.amount_cents,
          reason: 'requested_by_customer',
          metadata: { refund_id: row.refund_id, booking_id: row.booking_id },
        },
        // The same key always returns the same refund: retries never double-refund.
        { idempotencyKey: `refund-${row.refund_id}` },
      )
      const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending'
      const { error: recErr } = await admin.rpc('svc_record_refund', {
        p_refund_id: row.refund_id,
        p_stripe_refund_id: refund.id,
        p_status: status,
        p_failure: refund.failure_reason ?? null,
      })
      if (recErr) throw recErr
      if (status === 'failed') result.failed++
      else result.succeeded++
    } catch (err) {
      result.failed++
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(message)
      await admin.rpc('svc_record_refund', {
        p_refund_id: row.refund_id,
        p_stripe_refund_id: null,
        p_status: 'failed',
        p_failure: message.slice(0, 500),
      })
    }
  }
  return result
}
