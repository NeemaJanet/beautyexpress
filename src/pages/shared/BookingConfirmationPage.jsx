import { useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate, formatTime } from '../../lib/availability.js'
import { LOCATION_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { getBooking } from '../../services/bookingService.js'

export default function BookingConfirmationPage() {
  const { id } = useParams()
  const { data: b, loading } = useAsync(() => getBooking(id), [id])
  useDocumentTitle('Booking confirmed')
  if (loading) return <LoadingState />
  if (!b) return <EmptyState title="Booking not found" />

  const isRequest = b.status === 'requested'
  return (
    <div className="mx-auto max-w-xl py-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-fuchsia-soft text-fuchsia-deep" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h1 className="mt-6 text-4xl">{isRequest ? 'Request sent' : 'You’re booked'}</h1>
      <p className="mt-3 text-stone">
        {isRequest
          ? `${b.stylist_profiles?.display_name} will confirm shortly. We’ll notify you as soon as they respond.`
          : `We’ve let ${b.stylist_profiles?.display_name} know. You’ll get a reminder the day before.`}
      </p>
      <div className="panel mt-8 p-6 text-left">
        <p className="font-medium">{b.stylist_services?.title}</p>
        <p className="mt-1">{formatDate(b.starts_at)} at {formatTime(b.starts_at)}</p>
        <p className="text-stone">{LOCATION_LABELS[b.location_type]}</p>
        <div className="mt-4 flex justify-between border-t border-sand pt-4">
          <span>Total</span>
          <span className="font-semibold">{formatMoney(b.total_cents, b.currency)}</span>
        </div>
        {b.payment_provider === 'pay_in_person' && <p className="mt-2 text-sm text-stone">Pay the stylist at your appointment.</p>}
        {b.payment_provider === 'manual_etransfer' && <p className="mt-2 text-sm text-stone">See the booking page for e-Transfer instructions.</p>}
        <p className="mt-2 text-sm text-stone">Reference {b.reference}</p>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button to={`/bookings/${b.id}`}>View booking</Button>
        <Button to="/client/bookings" variant="secondary">All my bookings</Button>
      </div>
    </div>
  )
}
