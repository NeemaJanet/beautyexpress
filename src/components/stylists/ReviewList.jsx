import { formatDate } from '../../lib/availability.js'
import { Avatar } from '../common/Avatar.jsx'
import { RatingStars } from '../common/RatingStars.jsx'

export function ReviewList({ reviews, stylistName }) {
  if (!reviews?.length) return <p className="text-stone">No reviews yet. Reviews appear after completed appointments.</p>
  return (
    <ul className="divide-y divide-sand">
      {reviews.map((r) => (
        <li key={r.id} className="py-5 first:pt-0">
          <div className="flex items-center gap-3">
            <Avatar src={r.author?.avatar_url} name={r.author?.display_name} size="sm" />
            <div>
              <p className="text-sm font-medium">{r.author?.display_name || 'Client'}</p>
              <p className="text-xs text-stone">{formatDate(r.created_at)}</p>
            </div>
            <div className="ml-auto">
              <RatingStars value={r.rating} />
            </div>
          </div>
          {r.comment && <p className="mt-3 max-w-[70ch] text-ink-soft">{r.comment}</p>}
          {r.stylist_reply && (
            <div className="mt-3 border-l-2 border-fuchsia pl-4 text-sm">
              <p className="font-medium">Reply from {stylistName}</p>
              <p className="text-ink-soft">{r.stylist_reply}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
