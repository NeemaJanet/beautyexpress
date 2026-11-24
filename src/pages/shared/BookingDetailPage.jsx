import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { PaymentBadge, StatusBadge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States.jsx'
import { BookingActions } from '../../components/bookings/BookingActions.jsx'
import { DisputeSection, ReviewSection } from '../../components/bookings/BookingExtras.jsx'
import { PaymentPanel } from '../../components/bookings/PaymentPanel.jsx'
import { PriceBreakdown } from '../../components/bookings/PriceBreakdown.jsx'
import { StatusTimeline } from '../../components/bookings/StatusTimeline.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate, formatDateTime, formatTime } from '../../lib/availability.js'
import { LOCATION_LABELS, PAYMENT_PROVIDER_LABELS } from '../../lib/bookingStatus.js'
import { mapsLink } from '../../lib/maps.js'
import { formatDuration, formatMoney } from '../../lib/pricing.js'
import { supabase } from '../../lib/supabase.js'
import { friendlyError } from '../../lib/validation.js'
import { getBooking, getBookingLocation } from '../../services/bookingService.js'
import { getPublicSettings } from '../../services/catalogService.js'
import { startConversation } from '../../services/messageService.js'
import { markEtransferSent, markPaidInPerson } from '../../services/paymentService.js'

export default function BookingDetailPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { user, isAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const booking = useAsync(() => getBooking(id), [id])
  const location = useAsync(() => getBookingLocation(id), [id, booking.data?.status])
  const settings = useAsync(getPublicSettings, [])
  const [showPay, setShowPay] = useState(params.get('pay') === '1')
  const [waitingForWebhook, setWaitingForWebhook] = useState(params.get('paid') === '1')
  useDocumentTitle(booking.data ? `Booking ${booking.data.reference}` : 'Booking')
  const reload = booking.reload

  // Live updates when the booking changes (payment confirmed, stylist accepted…).
  useEffect(() => {
    const channel = supabase
      .channel(`booking-${id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => reload())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [id, reload])

  // After paying, Stripe notifies our server by webhook; poll briefly as a fallback.
  useEffect(() => {
    if (!waitingForWebhook) return undefined
    let tries = 0
    const t = setInterval(async () => {
      tries += 1
      const fresh = await reload()
      if ((fresh && fresh.status !== 'pending_payment') || tries > 15) {
        clearInterval(t)
        setWaitingForWebhook(false)
        if (fresh?.status !== 'pending_payment') {
          setParams({}, { replace: true })
          navigate(`/bookings/${id}/confirmed`, { replace: true })
        }
      }
    }, 2000)
    return () => clearInterval(t)
  }, [waitingForWebhook, reload, id, navigate, setParams])

  if (booking.loading && !booking.data) return <LoadingState />
  if (booking.error) return <ErrorState error={booking.error} onRetry={reload} />
  if (!booking.data) return <EmptyState title="Booking not found" action={<Button to="/client/bookings">My bookings</Button>}>It may belong to another account.</EmptyState>

  const b = booking.data
  const viewer = b.client_id === user.id ? 'client' : b.stylist_id === user.id ? 'stylist' : isAdmin ? 'admin' : 'client'
  const sp = b.stylist_profiles
  const otherName = viewer === 'stylist' ? b.client?.full_name || 'Client' : sp?.display_name
  const optionIds = b.line_items.filter((li) => li.kind === 'option').map((li) => li.ref_id)
  const paidOnline = b.payments.filter((p) => p.provider === 'stripe' && ['succeeded', 'partially_refunded', 'refunded'].includes(p.status)).reduce((s, p) => s + p.amount_cents, 0)
  const balanceDue = b.payment_provider === 'stripe' && paidOnline > 0 && paidOnline < b.total_cents && ['confirmed', 'in_progress', 'completed'].includes(b.status)
  const canPayNow = viewer === 'client' && (b.status === 'pending_payment' || balanceDue)

  const message = async () => {
    try {
      const conv = await startConversation(viewer === 'stylist' ? b.client_id : b.stylist_id)
      navigate(`/messages/${conv}`)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const payAction = async (fn, ok) => {
    try {
      await fn()
      toast.success(ok)
      reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-stone">Booking {b.reference}</p>
          <h1 className="mt-1 text-3xl sm:text-4xl">{b.stylist_services?.title}</h1>
          <p className="mt-2 text-lg">{formatDate(b.starts_at)}, {formatTime(b.starts_at)}–{formatTime(b.ends_at)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <span className="text-sm text-stone">{formatDuration(b.duration_minutes)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer !== 'admin' && <Button variant="secondary" onClick={message}>Message {otherName?.split(' ')[0]}</Button>}
          <Button variant="ghost" to={`/bookings/${b.id}/receipt`}>Receipt</Button>
        </div>
      </div>

      {waitingForWebhook && (
        <div role="status" className="rounded-[var(--radius-panel)] bg-info-soft p-4 text-info">
          Payment received by Stripe. Confirming your booking…
        </div>
      )}

      {b.status === 'pending_payment' && viewer === 'client' && !waitingForWebhook && (
        <div className="rounded-[var(--radius-panel)] border border-warn/30 bg-warn-soft p-4 text-warn">
          <HoldCountdown until={b.hold_expires_at} />
        </div>
      )}

      {canPayNow && !waitingForWebhook && (
        <section className="panel p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold">{balanceDue ? 'Pay the remaining balance' : 'Payment'}</h2>
          {showPay || b.status === 'pending_payment' ? (
            <PaymentPanel bookingId={b.id} onPaid={() => setWaitingForWebhook(true)} />
          ) : (
            <Button variant="accent" onClick={() => setShowPay(true)}>Pay {formatMoney(b.total_cents - paidOnline, b.currency)}</Button>
          )}
        </section>
      )}

      <section className="panel p-6">
        <BookingActions booking={b} viewer={viewer} onChanged={reload} optionIds={optionIds} stylistTimeZone={sp?.timezone} />
        {b.status === 'requested' && viewer === 'client' && <p className="mt-3 text-sm text-stone">Waiting for {sp?.display_name} to accept your request.</p>}
        {b.cancellation_reason && <p className="mt-3 text-sm text-stone">Reason given: {b.cancellation_reason}</p>}
        {['completed', 'cancelled_by_client', 'cancelled_by_stylist', 'cancelled_by_admin', 'declined', 'expired', 'no_show'].includes(b.status) && viewer === 'client' && (
          <Button className="mt-1" to={`/book/${b.stylist_service_id}`}>Book again</Button>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold">Details</h2>
          <div className="mb-4 flex items-center gap-3">
            <Avatar src={viewer === 'stylist' ? b.client?.avatar_url : sp?.avatar_url} name={otherName} size="md" />
            <div>
              <p className="font-medium">{otherName}</p>
              {viewer !== 'stylist' && <Link to={`/stylists/${b.stylist_id}`} className="text-sm text-stone hover:text-ink">View profile</Link>}
              {viewer !== 'client' && b.client?.phone && <a href={`tel:${b.client.phone}`} className="block text-sm text-stone">{b.client.phone}</a>}
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-stone">Where</dt>
              <dd className="font-medium">{LOCATION_LABELS[b.location_type]}</dd>
              {location.data?.name && <dd>{location.data.name}</dd>}
              {location.data?.address ? (
                <dd>
                  {location.data.address}{' '}
                  <a className="link" href={mapsLink(location.data.address)} target="_blank" rel="noreferrer">Open in maps</a>
                </dd>
              ) : location.data && !location.data.revealed ? (
                <dd className="text-stone">The address is shared once the booking is confirmed.</dd>
              ) : null}
              {location.data?.access_notes && <dd className="text-stone">Access: {location.data.access_notes}</dd>}
              {location.data?.contact_phone && <dd className="text-stone">Phone on the day: {location.data.contact_phone}</dd>}
              {b.distance_km != null && <dd className="text-stone">About {b.distance_km} km from the stylist’s area</dd>}
            </div>
            {b.client_notes && (
              <div>
                <dt className="text-stone">Notes from the client</dt>
                <dd className="whitespace-pre-line">{b.client_notes}</dd>
              </div>
            )}
            <div>
              <dt className="text-stone">Booked</dt>
              <dd>{formatDateTime(b.created_at)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold">Price</h2>
          <PriceBreakdown items={b.line_items} total={b.total_cents} currency={b.currency} />
          {viewer !== 'client' && (
            <p className="mt-3 text-sm text-stone">
              Stylist earnings after platform commission: {formatMoney(b.stylist_earnings_cents, b.currency)}
            </p>
          )}
          <h3 className="mb-2 mt-6 text-sm font-semibold">Payments</h3>
          {!b.payments.length ? (
            <p className="text-sm text-stone">{b.payment_provider === 'stripe' ? 'Not paid yet.' : 'No payment records.'}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {b.payments.map((p) => (
                <li key={p.id} className="rounded-[var(--radius-control)] bg-sand-soft p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{PAYMENT_PROVIDER_LABELS[p.provider]} ({p.kind})</span>
                    <span className="font-medium">{formatMoney(p.amount_cents, p.currency)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <PaymentBadge status={p.status} />
                    {p.failure_reason && <span className="text-xs text-danger">{p.failure_reason}</span>}
                  </div>
                  {p.provider === 'manual_etransfer' && viewer === 'client' && ['requires_payment', 'failed'].includes(p.status) && b.status !== 'cancelled_by_client' && (
                    <div className="mt-3 space-y-2 border-t border-sand pt-3">
                      <p>
                        Send an Interac e-Transfer of <strong>{formatMoney(p.amount_cents, p.currency)}</strong> to{' '}
                        <strong>{settings.data?.etransfer_recipient_email || 'the address provided by support'}</strong> with the message <strong>{p.reference_code}</strong>.
                      </p>
                      <p className="text-xs text-stone">Our team checks e-Transfers manually; this can take up to one business day.</p>
                      <Button size="sm" onClick={() => payAction(() => markEtransferSent(p.id), 'Thanks — we’ll verify your e-Transfer')}>I’ve sent the e-Transfer</Button>
                    </div>
                  )}
                  {p.provider === 'pay_in_person' && viewer === 'stylist' && p.status === 'requires_payment' && ['confirmed', 'in_progress', 'completed'].includes(b.status) && (
                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => payAction(() => markPaidInPerson(p.id), 'Marked as paid')}>
                      Mark as paid in person
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {b.refunds.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold">Refunds</h3>
              <ul className="space-y-2 text-sm">
                {b.refunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="text-stone">{formatDate(r.created_at)}</span>
                    <PaymentBadge status={r.status} />
                    <span className="font-medium">{formatMoney(r.amount_cents, b.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <ReviewSection booking={b} viewer={viewer} userId={user.id} onChanged={reload} />
      {viewer !== 'admin' && <DisputeSection booking={b} userId={user.id} onChanged={reload} />}

      <section className="panel p-6">
        <h2 className="mb-4 font-sans text-lg font-semibold">History</h2>
        <StatusTimeline history={b.history} />
      </section>
    </div>
  )
}

/** Live countdown for the payment hold (updates every 15 seconds). */
function HoldCountdown({ until }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  if (!until) return null
  const minutes = Math.max(0, Math.round((new Date(until).getTime() - now) / 60000))
  return minutes > 0 ? (
    <>Your time is held for {minutes} more minute{minutes === 1 ? '' : 's'}. Complete payment to secure it.</>
  ) : (
    <>Your hold has expired. Please go back and choose a time again.</>
  )
}
