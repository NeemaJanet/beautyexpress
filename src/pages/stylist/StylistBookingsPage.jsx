import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { BookingCard } from '../../components/bookings/BookingCard.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate, toDateKey } from '../../lib/availability.js'
import { CANCELLED_STATUSES } from '../../lib/bookingStatus.js'
import { listBookings } from '../../services/bookingService.js'

const TABS = {
  calendar: { label: 'Next 14 days', statuses: ['pending_payment', 'requested', 'confirmed', 'in_progress'], days: 14 },
  requests: { label: 'Requests', statuses: ['requested'] },
  upcoming: { label: 'All upcoming', statuses: ['confirmed', 'in_progress'], ascending: true },
  past: { label: 'Past', statuses: ['completed', 'no_show'], ascending: false },
  cancelled: { label: 'Cancelled', statuses: CANCELLED_STATUSES, ascending: false },
}

export default function StylistBookingsPage() {
  useDocumentTitle('Appointments')
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'calendar'
  const cfg = TABS[tab]
  const now = new Date()

  const list = useAsync(
    () =>
      listBookings({
        as: 'stylist',
        userId: user.id,
        statuses: cfg.statuses,
        ascending: cfg.ascending ?? true,
        from: cfg.days ? new Date(now.getTime() - 6 * 3600e3).toISOString() : undefined,
        to: cfg.days ? new Date(now.getTime() + cfg.days * 86400e3).toISOString() : undefined,
        limit: 200,
      }),
    [user.id, tab],
  )
  const requestsCount = useAsync(() => listBookings({ as: 'stylist', userId: user.id, statuses: ['requested'], limit: 100 }), [user.id, tab])

  // Group by day for the calendar view.
  const byDay = {}
  if (tab === 'calendar') {
    for (const b of list.data || []) (byDay[toDateKey(b.starts_at)] ??= []).push(b)
  }

  return (
    <div>
      <PageHeader title="Appointments" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })}
        tabs={Object.entries(TABS).map(([value, t]) => ({ value, label: t.label, count: value === 'requests' ? requestsCount.data?.length : 0 }))} />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length}
        empty={<EmptyState title={tab === 'requests' ? 'No requests waiting' : 'Nothing here yet'} />}>
        {tab === 'calendar' ? (
          <div className="space-y-8">
            {Object.entries(byDay).map(([day, bookings]) => (
              <section key={day}>
                <h2 className="mb-3 font-sans text-sm font-semibold text-stone">{formatDate(bookings[0].starts_at)}</h2>
                <div className="space-y-3">{bookings.map((b) => <BookingCard key={b.id} booking={b} viewer="stylist" />)}</div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-3">{list.data?.map((b) => <BookingCard key={b.id} booking={b} viewer="stylist" />)}</div>
        )}
      </AsyncBoundary>
    </div>
  )
}
