// POST /functions/v1/process-refund
//
// Admin (signed in):   { booking_id }            -> send this booking's pending refunds to Stripe
//                      { refund_id, retry: true } -> retry one failed refund
// Scheduled job:       header x-cron-secret       -> send all pending refunds
//
// Refund AMOUNTS are decided in the database (cancel_booking,
// admin_update_dispute). This function only executes them.
import { fromDbError, handler, json, requireUuid } from '../_shared/http.ts'
import { processPendingRefunds } from '../_shared/refunds.ts'
import { stripeClient } from '../_shared/stripe.ts'
import { adminClient, isCronRequest, requireAdmin } from '../_shared/supabase.ts'

Deno.serve(
  handler(async (req, body) => {
    const admin = adminClient()

    if (isCronRequest(req)) {
      const result = await processPendingRefunds(admin, stripeClient(), null, 50)
      return json(req, result)
    }

    const { client } = await requireAdmin(req)
    if (body.refund_id && body.retry) {
      const refundId = requireUuid(body.refund_id, 'refund_id')
      const { error } = await client.rpc('admin_retry_failed_refund', { p_refund_id: refundId })
      if (error) throw fromDbError(error)
      const { data: row } = await admin.from('refunds').select('booking_id').eq('id', refundId).single()
      const result = await processPendingRefunds(admin, stripeClient(), row?.booking_id ?? null)
      return json(req, result)
    }

    const bookingId = requireUuid(body.booking_id, 'booking_id')
    const result = await processPendingRefunds(admin, stripeClient(), bookingId)
    return json(req, result)
  }),
)
