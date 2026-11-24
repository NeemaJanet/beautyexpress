import { Link } from 'react-router-dom'
import { formatMoney } from '../../lib/pricing.js'
import { Avatar } from '../common/Avatar.jsx'
import { VerifiedBadge } from '../common/Badge.jsx'
import { RatingStars } from '../common/RatingStars.jsx'

/** One search result. `s` is a row from search_stylists(). */
export function StylistCard({ s, currency = 'cad' }) {
  const modes = [s.offers_mobile && 'Comes to you', s.offers_studio && 'Studio', s.offers_salon && 'Salon'].filter(Boolean)
  return (
    <Link
      to={`/stylists/${s.stylist_id}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-media)] border border-sand bg-paper transition-colors hover:border-brown"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-sand-soft">
        {s.cover_image_url ? (
          <img src={s.cover_image_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-4xl text-fuchsia-deep/40">{s.display_name?.[0]}</div>
        )}
        {s.is_featured && (
          <span className="absolute left-3 top-3 rounded-full bg-fuchsia px-3 py-1 text-xs text-white">Featured</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start gap-3">
          <Avatar src={s.avatar_url} name={s.display_name} size="sm" className="relative z-10 -mt-9 border-2 border-paper" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-lg leading-tight">{s.display_name}</h3>
            {s.business_name && <p className="truncate text-sm text-stone">{s.business_name}</p>}
          </div>
          {s.is_verified && <VerifiedBadge />}
        </div>
        {s.headline && <p className="line-clamp-2 text-sm text-ink-soft">{s.headline}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
          <RatingStars value={s.rating_avg} count={s.rating_count} />
          <span className="text-stone">
            {s.city}
            {s.distance_km != null && `, ${Number(s.distance_km).toFixed(1)} km away`}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-sand pt-3 text-sm">
          <span className="text-stone">{modes.join(', ')}</span>
          <span className="font-semibold">from {formatMoney(s.from_price_cents, currency)}</span>
        </div>
      </div>
    </Link>
  )
}
