// POST /functions/v1/cancel-booking   { booking_id, action: 'cancel' | 'decline', reason? }
//
// Cancels (client/stylist/admin) or declines (stylist) a booking using the
// database rules, then immediately sends any refund to Stripe.
import { fromDbError, handler, HttpError, json, optionalString, requireUuid } from '../_shared/http.ts'
import { processPendingRefunds } from '../_shared/refunds.ts'
import { stripeClient } from '../_shared/stripe.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

Deno.serve(
  handler(async (req, body) => {
    const bookingId = requireUuid(body.booking_id, 'booking_id')
    const action = body.action ?? 'cancel'
    if (action !== 'cancel' && action !== 'decline') throw new HttpError(400, 'action must be cancel or decline')
    const reason = optionalString(body.reason, 'reason', 500)

    const { client } = await requireUser(req)
    const { data, error } =
      action === 'decline'
        ? await client.rpc('transition_booking', { p_booking_id: bookingId, p_to: 'declined', p_reason: reason })
        : await client.rpc('cancel_booking', { p_booking_id: bookingId, p_reason: reason })
    if (error) throw fromDbError(error)

    const outcome = data as { status: string; refund_queued_cents: number; fee_cents?: number }
    let refund: unknown = null
    if (outcome.refund_queued_cents > 0) {
      if (Deno.env.get('STRIPE_SECRET_KEY')) {
        try {
          refund = await processPendingRefunds(adminClient(), stripeClient(), bookingId)
        } catch (err) {
          // The cancellation stands; the scheduled job / admin will retry the refund.
          console.error('Refund processing failed', err)
          refund = { deferred: true }
        }
      } else {
        refund = { deferred: true, note: 'Stripe is not configured; refund recorded for manual processing.' }
      }
    }
    return json(req, { ...outcome, refund })
  }),
)
