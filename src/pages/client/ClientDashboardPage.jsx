import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { BookingCard } from '../../components/bookings/BookingCard.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { UPCOMING_STATUSES } from '../../lib/bookingStatus.js'
import { listBookings, listBookingsToReview } from '../../services/bookingService.js'
import { listNotifications } from '../../services/notificationService.js'

export default function ClientDashboardPage() {
  useDocumentTitle('Overview')
  const { user, profile } = useAuth()
  const upcoming = useAsync(
    () => listBookings({ as: 'client', userId: user.id, statuses: UPCOMING_STATUSES, from: new Date(Date.now() - 6 * 3600 * 1000).toISOString(), limit: 5 }),
    [user.id],
  )
  const toReview = useAsync(() => listBookingsToReview(user.id), [user.id])
  const notes = useAsync(() => listNotifications(user.id, 5), [user.id])
  const first = profile?.full_name?.split(' ')[0]

  return (
    <div className="space-y-10">
      <PageHeader title={first ? `Hi, ${first}` : 'Welcome'} actions={<Button to="/explore">Book an appointment</Button>} />

      <section>
        <SectionTitle action={<Link to="/client/bookings" className="link text-sm">All bookings</Link>}>Coming up</SectionTitle>
        {upcoming.loading ? (
          <LoadingState />
        ) : !upcoming.data?.length ? (
          <EmptyState title="Nothing booked yet" action={<Button to="/explore">Find a stylist</Button>}>
            Browse stylists near you and book in a few taps.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {upcoming.data.map((b) => <BookingCard key={b.id} booking={b} />)}
          </div>
        )}
      </section>

      {toReview.data?.length > 0 && (
        <section>
          <SectionTitle>Waiting for your review</SectionTitle>
          <ul className="space-y-2">
            {toReview.data.slice(0, 3).map((b) => (
              <li key={b.id} className="panel flex items-center justify-between gap-3 p-4 text-sm">
                <span>{b.stylist_services?.title} with {b.stylist_profiles?.display_name}</span>
                <Button size="sm" variant="secondary" to={`/bookings/${b.id}`}>Leave a review</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle action={<Link to="/notifications" className="link text-sm">All notifications</Link>}>Latest updates</SectionTitle>
        {!notes.data?.length ? (
          <p className="text-stone">No updates yet.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper">
            {notes.data.map((n) => (
              <li key={n.id} className="px-4 py-3 text-sm">
                {n.link ? <Link to={n.link} className="font-medium hover:text-brown">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                <p className="text-stone">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
