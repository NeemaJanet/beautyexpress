import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { listBookingsToReview, listMyReviews } from '../../services/bookingService.js'

export default function ReviewsPage() {
  useDocumentTitle('My reviews')
  const { user } = useAuth()
  const pending = useAsync(() => listBookingsToReview(user.id), [user.id])
  const mine = useAsync(() => listMyReviews(user.id), [user.id])

  return (
    <div className="space-y-10">
      <PageHeader title="Reviews" description="Reviews help other clients choose, and help great stylists get found." />
      <section>
        <SectionTitle>To review</SectionTitle>
        {pending.loading ? <LoadingState /> : !pending.data?.length ? (
          <p className="text-stone">You’re all caught up.</p>
        ) : (
          <ul className="space-y-2">
            {pending.data.map((b) => (
              <li key={b.id} className="panel flex items-center justify-between gap-3 p-4">
                <div className="text-sm">
                  <p className="font-medium">{b.stylist_services?.title}</p>
                  <p className="text-stone">{b.stylist_profiles?.display_name}, {formatDate(b.starts_at)}</p>
                </div>
                <Button size="sm" to={`/bookings/${b.id}`}>Write review</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <SectionTitle>Your reviews</SectionTitle>
        {mine.loading ? <LoadingState /> : !mine.data?.length ? (
          <EmptyState title="No reviews yet">After an appointment is completed you can rate it here.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {mine.data.map((r) => (
              <li key={r.id} className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/bookings/${r.booking_id}`} className="font-medium hover:text-brown">
                    {r.bookings?.stylist_services?.title} with {r.stylist_profiles?.display_name}
                  </Link>
                  <RatingStars value={r.rating} />
                </div>
                {r.comment && <p className="mt-2 text-ink-soft">{r.comment}</p>}
                {r.stylist_reply && <p className="mt-2 border-l-2 border-fuchsia pl-3 text-sm">Reply: {r.stylist_reply}</p>}
                <p className="mt-2 text-xs text-stone">{formatDate(r.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
