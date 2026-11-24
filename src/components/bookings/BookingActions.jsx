import { useState } from 'react'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { ACTION_TO_STATUS, availableActions } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { friendlyError } from '../../lib/validation.js'
import { cancelBooking, cancellationPreview, rescheduleBooking, transitionBooking } from '../../services/bookingService.js'
import { Button } from '../common/Button.jsx'
import { ConfirmDialog, Modal } from '../common/Modal.jsx'
import { FormError, TextArea } from '../common/Field.jsx'
import { LoadingState } from '../common/States.jsx'
import { SlotPicker } from './SlotPicker.jsx'

const LABELS = {
  accept: 'Accept booking',
  decline: 'Decline',
  start: 'Start appointment',
  complete: 'Mark as completed',
  no_show: 'Client did not show up',
  cancel: 'Cancel booking',
  reschedule: 'Reschedule',
}

/** Status-changing buttons and their confirmation dialogs. */
export function BookingActions({ booking, viewer, onChanged, optionIds, stylistTimeZone }) {
  const toast = useToast()
  const actions = availableActions(booking, viewer).filter((a) => a !== 'pay')
  const [open, setOpen] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [newSlot, setNewSlot] = useState(null)

  const close = () => {
    setOpen(null)
    setReason('')
    setError(null)
    setNewSlot(null)
  }

  const run = async (fn, success) => {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      toast.success(success)
      if (result?.refund?.deferred) toast.info('The refund is recorded and will be processed shortly.')
      close()
      onChanged?.()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!actions.length) return null

  return (
    <div className="flex flex-wrap gap-2">
      {actions.includes('accept') && (
        <Button variant="accent" loading={busy && open === 'accept'} onClick={() => { setOpen('accept'); run(() => transitionBooking(booking.id, 'confirmed'), 'Booking accepted') }}>
          {LABELS.accept}
        </Button>
      )}
      {['start', 'complete'].filter((a) => actions.includes(a)).map((a) => (
        <Button key={a} variant="accent" onClick={() => setOpen(a)}>{LABELS[a]}</Button>
      ))}
      {actions.includes('reschedule') && <Button variant="secondary" onClick={() => setOpen('reschedule')}>{LABELS.reschedule}</Button>}
      {['decline', 'no_show', 'cancel'].filter((a) => actions.includes(a)).map((a) => (
        <Button key={a} variant="danger-outline" onClick={() => setOpen(a)}>{LABELS[a]}</Button>
      ))}
      {open === 'accept' && error && <FormError error={error} />}

      <ConfirmDialog
        open={open === 'start' || open === 'complete' || open === 'no_show'}
        onClose={close}
        busy={busy}
        title={LABELS[open] || ''}
        confirmLabel={LABELS[open] || 'Confirm'}
        tone={open === 'no_show' ? 'danger' : 'primary'}
        onConfirm={() => run(() => transitionBooking(booking.id, ACTION_TO_STATUS[open]), 'Booking updated')}
      >
        {open === 'complete' && 'The client will be asked to leave a review. Payouts are released after the hold period.'}
        {open === 'start' && 'Let the client know you have started.'}
        {open === 'no_show' && 'Only use this if the client did not arrive. Amounts paid online will not be refunded.'}
        <FormError error={error} />
      </ConfirmDialog>

      <Modal
        open={open === 'decline'}
        onClose={close}
        title="Decline this request"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Keep request</Button>
            <Button variant="danger" loading={busy} onClick={() => run(() => cancelBooking(booking, { action: 'decline', reason }), 'Request declined')}>
              Decline request
            </Button>
          </>
        }
      >
        <p className="mb-4 text-ink-soft">The client is refunded in full for anything paid online.</p>
        <TextArea label="Message to the client (optional)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>

      {open === 'cancel' && (
        <CancelDialog booking={booking} viewer={viewer} reason={reason} setReason={setReason} busy={busy} error={error} onClose={close}
          onConfirm={() => run(() => cancelBooking(booking, { reason }), 'Booking cancelled')} />
      )}

      <Modal
        open={open === 'reschedule'}
        onClose={close}
        title="Choose a new time"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Keep current time</Button>
            <Button disabled={!newSlot} loading={busy} onClick={() => run(() => rescheduleBooking(booking.id, newSlot, reason), 'Booking rescheduled')}>
              Move appointment
            </Button>
          </>
        }
      >
        {viewer === 'client' && booking.booking_mode === 'approval' && (
          <p className="mb-3 text-sm text-stone">The stylist will need to approve the new time.</p>
        )}
        {open === 'reschedule' && (
          <SlotPicker serviceId={booking.stylist_service_id} optionIds={optionIds} stylistTimeZone={stylistTimeZone} value={newSlot} onChange={setNewSlot} excludeBookingId={booking.id} />
        )}
        <TextArea className="mt-4" label="Note (optional)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
    </div>
  )
}

function CancelDialog({ booking, viewer, reason, setReason, busy, error, onClose, onConfirm }) {
  const preview = useAsync(() => cancellationPreview(booking.id), [booking.id])
  const p = preview.data
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel this booking?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep booking</Button>
          <Button variant="danger" loading={busy} onClick={onConfirm} disabled={preview.loading}>Cancel booking</Button>
        </>
      }
    >
      {preview.loading ? (
        <LoadingState className="py-4" />
      ) : p ? (
        <div className="space-y-2 text-sm text-ink-soft">
          {p.amount_paid_cents > 0 ? (
            <>
              <p>Paid online: {formatMoney(p.amount_paid_cents, booking.currency)}</p>
              {p.fee_cents > 0 && (
                <p className="text-warn">
                  Late cancellation fee ({p.late_cancellation_fee_percent}%, less than {p.free_cancellation_hours} hours before): {formatMoney(p.fee_cents, booking.currency)}
                </p>
              )}
              <p className="font-medium text-ink">Refund: {formatMoney(p.refund_cents, booking.currency)}</p>
            </>
          ) : (
            <p>Nothing has been paid online for this booking, so there is nothing to refund.</p>
          )}
          {viewer === 'stylist' && <p>The client is refunded in full and notified.</p>}
        </div>
      ) : null}
      <TextArea className="mt-4" label="Reason (optional)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-3"><FormError error={error} /></div>
    </Modal>
  )
}
