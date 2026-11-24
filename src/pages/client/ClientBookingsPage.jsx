import { useState } from 'react'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { BookingCard } from '../../components/bookings/BookingCard.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { CANCELLED_STATUSES, PAST_STATUSES, UPCOMING_STATUSES } from '../../lib/bookingStatus.js'
import { listBookings } from '../../services/bookingService.js'

const TABS = {
  upcoming: { statuses: UPCOMING_STATUSES, ascending: true, empty: 'No upcoming bookings' },
  past: { statuses: PAST_STATUSES, ascending: false, empty: 'No past appointments yet' },
  cancelled: { statuses: CANCELLED_STATUSES, ascending: false, empty: 'No cancelled bookings' },
}

export default function ClientBookingsPage() {
  useDocumentTitle('My bookings')
  const { user } = useAuth()
  const [tab, setTab] = useState('upcoming')
  const cfg = TABS[tab]
  const list = useAsync(() => listBookings({ as: 'client', userId: user.id, statuses: cfg.statuses, ascending: cfg.ascending }), [user.id, tab])

  return (
    <div>
      <PageHeader title="My bookings" actions={<Button to="/explore">New booking</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'cancelled', label: 'Cancelled' }]} />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length}
        empty={<EmptyState title={cfg.empty} action={tab === 'upcoming' && <Button to="/explore">Find a stylist</Button>} />}>
        <div className="space-y-3">
          {list.data?.map((b) => <BookingCard key={b.id} booking={b} />)}
        </div>
      </AsyncBoundary>
    </div>
  )
}
