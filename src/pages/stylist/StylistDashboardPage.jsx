import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { BookingCard } from '../../components/bookings/BookingCard.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatMoney } from '../../lib/pricing.js'
import { supabase, unwrap } from '../../lib/supabase.js'
import { listBookings } from '../../services/bookingService.js'
import { getPublicSettings } from '../../services/catalogService.js'
import { getMyStylistPrivate, listAvailability, listMyServices, listPortfolio } from '../../services/stylistService.js'

export default function StylistDashboardPage() {
  useDocumentTitle('Stylist dashboard')
  const { user, stylistProfile: sp } = useAuth()
  const [params] = useSearchParams()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const requests = useAsync(() => listBookings({ as: 'stylist', userId: user.id, statuses: ['requested'], limit: 20 }), [user.id])
  const upcoming = useAsync(
    () => listBookings({ as: 'stylist', userId: user.id, statuses: ['confirmed', 'in_progress'], from: new Date(now.getTime() - 4 * 3600e3).toISOString(), limit: 6 }),
    [user.id],
  )
  const month = useAsync(
    async () =>
      unwrap(
        await supabase.from('bookings').select('stylist_earnings_cents, currency').eq('stylist_id', user.id).eq('status', 'completed').gte('completed_at', monthStart),
      ),
    [user.id],
  )
  const setup = useAsync(async () => {
    const [priv, services, hours, portfolio, settings] = await Promise.all([
      getMyStylistPrivate(user.id),
      listMyServices(user.id),
      listAvailability(user.id),
      listPortfolio(user.id),
      getPublicSettings(),
    ])
    return { priv, services, hours, portfolio, settings }
  }, [user.id])

  const earned = (month.data || []).reduce((s, b) => s + b.stylist_earnings_cents, 0)
  const checklist = setup.data
    ? [
        { done: Boolean(sp?.avatar_url), label: 'Add a profile photo', to: '/stylist/profile' },
        { done: setup.data.portfolio.length >= 3, label: 'Upload at least 3 portfolio photos', to: '/stylist/portfolio' },
        { done: setup.data.services.filter((s) => s.is_active).length >= 2, label: 'List two or more services', to: '/stylist/services' },
        { done: setup.data.hours.length > 0, label: 'Set your working hours', to: '/stylist/availability' },
        ...(setup.data.settings.online_payments_enabled
          ? [{ done: setup.data.priv.stripe_payouts_enabled, label: 'Set up payouts to your bank', to: '/stylist/earnings' }]
          : []),
      ]
    : []
  const remaining = checklist.filter((c) => !c.done)

  return (
    <div className="space-y-10">
      <PageHeader
        title={params.get('welcome') ? 'Your profile is live' : `Hi, ${sp?.display_name?.split(' ')[0] || 'there'}`}
        description={params.get('welcome') ? 'Clients can now find and book you. A few more details will help you stand out.' : undefined}
        actions={<Button variant="secondary" to={`/stylists/${user.id}`}>View public profile</Button>}
      />

      {sp?.approval_status === 'pending' && setup.data?.settings && (
        <p className="rounded-[var(--radius-panel)] bg-info-soft p-4 text-sm text-info">
          New profiles may be reviewed by our team before they appear in search. We’ll notify you when that’s done.
        </p>
      )}
      {!sp?.is_accepting_bookings && (
        <p className="rounded-[var(--radius-panel)] bg-warn-soft p-4 text-sm text-warn">
          You are not accepting new bookings. <Link to="/stylist/settings" className="underline">Change this in settings</Link>.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests waiting" value={requests.data?.length ?? '—'} to="/stylist/bookings?tab=requests" highlight={requests.data?.length > 0} />
        <Stat label="Upcoming appointments" value={upcoming.data?.length ?? '—'} to="/stylist/bookings" />
        <Stat label="Earned this month" value={formatMoney(earned)} to="/stylist/earnings" />
        <div className="panel p-5">
          <p className="text-sm text-stone">Rating</p>
          <div className="mt-2"><RatingStars value={sp?.rating_avg} count={sp?.rating_count} /></div>
        </div>
      </section>

      {remaining.length > 0 && (
        <section className="panel p-6">
          <SectionTitle>Finish setting up</SectionTitle>
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center justify-between gap-3 text-sm">
                <span className={c.done ? 'text-stone line-through' : ''}>{c.label}</span>
                {c.done ? <Badge tone="green">Done</Badge> : <Link to={c.to} className="link">Do it now</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle action={<Link to="/stylist/bookings?tab=requests" className="link text-sm">All requests</Link>}>Booking requests</SectionTitle>
        {requests.loading ? <LoadingState /> : !requests.data?.length ? (
          <p className="text-stone">No requests waiting. New requests appear here and in your notifications.</p>
        ) : (
          <div className="space-y-3">{requests.data.map((b) => <BookingCard key={b.id} booking={b} viewer="stylist" />)}</div>
        )}
      </section>

      <section>
        <SectionTitle action={<Link to="/stylist/bookings" className="link text-sm">Calendar</Link>}>Next appointments</SectionTitle>
        {upcoming.loading ? <LoadingState /> : !upcoming.data?.length ? (
          <EmptyState title="No confirmed appointments yet">Share your profile link with clients to get your first booking.</EmptyState>
        ) : (
          <div className="space-y-3">{upcoming.data.map((b) => <BookingCard key={b.id} booking={b} viewer="stylist" />)}</div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, to, highlight }) {
  return (
    <Link to={to} className={`panel block p-5 hover:border-brown ${highlight ? 'border-brown bg-brown-soft' : ''}`}>
      <p className="text-sm text-stone">{label}</p>
      <p className="mt-1 font-display text-3xl">{value}</p>
    </Link>
  )
}
