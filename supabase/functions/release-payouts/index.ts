// POST /functions/v1/release-payouts
//
// Transfers stylists' earnings to their Stripe connected accounts for
// bookings that finished more than payout_hold_hours ago with no open dispute.
// Called by a schedule (x-cron-secret header) or by an admin.
//
// Uses "separate charges and transfers": the client pays the platform, then
// the platform transfers the stylist's share. Each transfer uses an
// idempotency key so a retry never pays twice.
import { handler, json } from '../_shared/http.ts'
import { stripeClient } from '../_shared/stripe.ts'
import { adminClient, isCronRequest, requireAdmin } from '../_shared/supabase.ts'

type PayoutRow = {
  payout_id: string
  booking_id: string
  stylist_id: string
  amount_cents: number
  currency: string
  stripe_account_id: string
  source_charge_id: string | null
}

Deno.serve(
  handler(async (req) => {
    if (!isCronRequest(req)) await requireAdmin(req)
    const admin = adminClient()
    const stripe = stripeClient()

    const { data, error } = await admin.rpc('svc_claim_payouts', { p_limit: 25 })
    if (error) throw error

    const results = []
    for (const row of (data ?? []) as PayoutRow[]) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: row.amount_cents,
            currency: row.currency,
            destination: row.stripe_account_id,
            transfer_group: `booking_${row.booking_id}`,
            // Ties the transfer to the client's charge so funds are available.
            ...(row.source_charge_id ? { source_transaction: row.source_charge_id } : {}),
            metadata: { payout_id: row.payout_id, booking_id: row.booking_id, stylist_id: row.stylist_id },
          },
          { idempotencyKey: `payout-${row.payout_id}` },
        )
        await admin.rpc('svc_record_payout', {
          p_payout_id: row.payout_id,
          p_transfer_id: transfer.id,
          p_status: 'transferred',
          p_failure: null,
        })
        results.push({ payout_id: row.payout_id, status: 'transferred' })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await admin.rpc('svc_record_payout', {
          p_payout_id: row.payout_id,
          p_transfer_id: null,
          p_status: 'failed',
          p_failure: message,
        })
        results.push({ payout_id: row.payout_id, status: 'failed', error: message })
      }
    }
    return json(req, { processed: results.length, results })
  }),
)
