import { Link } from 'react-router-dom'
import { formatDate, formatTime } from '../../lib/availability.js'
import { LOCATION_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { Avatar } from '../common/Avatar.jsx'
import { StatusBadge } from '../common/Badge.jsx'

/** Compact booking row for lists. `viewer` decides whose name is shown. */
export function BookingCard({ booking, viewer = 'client' }) {
  const other =
    viewer === 'stylist'
      ? { name: booking.profiles?.full_name || 'Client', avatar: booking.profiles?.avatar_url }
      : { name: booking.stylist_profiles?.display_name, avatar: booking.stylist_profiles?.avatar_url }
  const start = new Date(booking.starts_at)
  return (
    <Link
      to={`/bookings/${booking.id}`}
      className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-sand bg-paper p-4 transition-colors hover:border-brown"
    >
      <div className="flex w-14 shrink-0 flex-col items-center border-r border-sand pr-4 text-center">
        <span className="text-xs text-stone">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
        <span className="font-display text-2xl leading-none">{start.getDate()}</span>
        <span className="text-xs text-stone">{start.toLocaleDateString(undefined, { weekday: 'short' })}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{booking.stylist_services?.title}</p>
        <p className="truncate text-sm text-stone">
          {formatTime(booking.starts_at)} · {LOCATION_LABELS[booking.location_type]}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-sm">
          <Avatar src={other.avatar} name={other.name} size="xs" />
          <span className="truncate text-ink-soft">{other.name}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <StatusBadge status={booking.status} />
        <span className="text-sm font-medium">{formatMoney(booking.total_cents, booking.currency)}</span>
      </div>
      <span className="sr-only">Open booking on {formatDate(booking.starts_at)}</span>
    </Link>
  )
}
