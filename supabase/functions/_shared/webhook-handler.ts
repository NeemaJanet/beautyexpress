// Stripe webhook event handling, separated from the HTTP layer so it can be
// unit-tested with fake dependencies (see supabase/functions/tests).
//
// Every handler is idempotent: Stripe may deliver the same event more than
// once, and the database functions ignore repeats.

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<Record<string, unknown> | null>

export interface EventStore {
  /** Returns 'duplicate' if this event id was already processed successfully. */
  claim(event: { id: string; type: string }): Promise<'new' | 'duplicate'>
  markProcessed(id: string): Promise<void>
  markFailed(id: string, error: string): Promise<void>
}

export interface WebhookDeps {
  rpc: Rpc
  store: EventStore
  /** Called when a payment arrived for a booking that can no longer be honoured. */
  onRefundQueued?: (bookingId: string) => Promise<void>
}

// Minimal shapes of the Stripe objects we read.
type StripeEvent = { id: string; type: string; data: { object: Record<string, any> } }

export const HANDLED_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.processing',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'account.updated',
  'transfer.reversed',
] as const

function refundStatus(stripeStatus: string): string {
  if (stripeStatus === 'succeeded') return 'succeeded'
  if (stripeStatus === 'failed') return 'failed'
  if (stripeStatus === 'canceled') return 'canceled'
  return 'processing' // pending / requires_action
}

export async function handleStripeEvent(
  event: StripeEvent,
  deps: WebhookDeps,
): Promise<{ status: 'processed' | 'duplicate' | 'ignored'; action?: unknown }> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { status: 'ignored' }
  }
  if ((await deps.store.claim(event)) === 'duplicate') {
    return { status: 'duplicate' }
  }

  try {
    const obj = event.data.object
    let action: unknown = null

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const charge = typeof obj.latest_charge === 'string' ? obj.latest_charge : obj.latest_charge?.id ?? null
        action = await deps.rpc('svc_record_payment_succeeded', {
          p_intent_id: obj.id,
          p_charge_id: charge,
          p_amount_cents: obj.amount_received ?? obj.amount,
        })
        const a = action as { action?: string; booking_id?: string } | null
        if (a?.action === 'refund_queued' && a.booking_id && deps.onRefundQueued) {
          await deps.onRefundQueued(a.booking_id)
        }
        break
      }
      case 'payment_intent.payment_failed':
        action = await deps.rpc('svc_record_payment_failed', {
          p_intent_id: obj.id,
          p_status: 'failed',
          p_reason: obj.last_payment_error?.message ?? 'Payment failed',
        })
        break
      case 'payment_intent.canceled':
        action = await deps.rpc('svc_record_payment_failed', {
          p_intent_id: obj.id,
          p_status: 'canceled',
          p_reason: obj.cancellation_reason ?? 'Payment cancelled',
        })
        break
      case 'payment_intent.processing':
        action = await deps.rpc('svc_record_payment_failed', {
          p_intent_id: obj.id,
          p_status: 'processing',
          p_reason: null,
        })
        break
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        action = await deps.rpc('svc_record_refund', {
          p_refund_id: obj.metadata?.refund_id ?? null,
          p_stripe_refund_id: obj.id,
          p_status: refundStatus(obj.status),
          p_failure: obj.failure_reason ?? null,
        })
        break
      case 'account.updated':
        action = await deps.rpc('svc_update_connect_account', {
          p_account_id: obj.id,
          p_details_submitted: Boolean(obj.details_submitted),
          p_charges_enabled: Boolean(obj.charges_enabled),
          p_payouts_enabled: Boolean(obj.payouts_enabled),
        })
        break
      case 'transfer.reversed':
        action = await deps.rpc('svc_record_transfer_reversed', { p_transfer_id: obj.id })
        break
    }

    await deps.store.markProcessed(event.id)
    return { status: 'processed', action }
  } catch (err) {
    await deps.store.markFailed(event.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}
