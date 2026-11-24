import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Badge, VerifiedBadge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States.jsx'
import { ReviewList } from '../../components/stylists/ReviewList.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { WEEKDAYS } from '../../lib/availability.js'
import { formatDuration, formatMoney } from '../../lib/pricing.js'
import { startConversation } from '../../services/messageService.js'
import { getStylistPublic, getStylistReviews, isFavorite, setFavorite } from '../../services/stylistService.js'

const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function StylistProfilePage() {
  const { id } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const stylist = useAsync(() => getStylistPublic(id), [id])
  const reviews = useAsync(() => getStylistReviews(id), [id])
  const fav = useAsync(() => (user ? isFavorite(user.id, id) : false), [user?.id, id])
  const [lightbox, setLightbox] = useState(null)
  const [messaging, setMessaging] = useState(false)
  useDocumentTitle(stylist.data?.display_name)

  if (stylist.loading) return <LoadingState className="min-h-[60vh]" />
  if (stylist.error) return <div className="container-page py-10"><ErrorState error={stylist.error} onRetry={stylist.reload} /></div>
  if (!stylist.data)
    return (
      <div className="container-page py-16">
        <EmptyState title="This stylist is not available" action={<Button to="/explore">Find another stylist</Button>}>
          The profile may be private or no longer active.
        </EmptyState>
      </div>
    )

  const s = stylist.data
  const isSelf = user?.id === s.id
  const modes = [s.offers_mobile && 'Comes to you', s.offers_studio && 'Own studio', s.offers_salon && 'Salon'].filter(Boolean)

  const toggleFavorite = async () => {
    if (!user) return navigate(`/sign-in?next=/stylists/${id}`)
    try {
      await setFavorite(user.id, id, !fav.data)
      fav.setData(!fav.data)
      toast.success(fav.data ? 'Removed from favourites' : 'Saved to favourites')
    } catch (e) {
      toast.error(e.message)
    }
  }

  const message = async () => {
    if (!user) return navigate(`/sign-in?next=/stylists/${id}`)
    setMessaging(true)
    try {
      const conversationId = await startConversation(id)
      navigate(`/messages/${conversationId}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setMessaging(false)
    }
  }

  const hoursByDay = WEEKDAYS.map((name, i) => ({ name, windows: s.hours.filter((h) => h.weekday === i) }))

  return (
    <div className="container-page py-10">
      {/* Header */}
      <section className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Avatar src={s.avatar_url} name={s.display_name} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-4xl">{s.display_name}</h1>
              {s.verification_status === 'verified' && <VerifiedBadge />}
            </div>
            {s.business_name && <p className="mt-1 text-lg text-stone">{s.business_name}</p>}
            <p className="mt-3 max-w-xl text-ink-soft">{s.headline}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <RatingStars value={s.rating_avg} count={s.rating_count} />
              <span className="text-stone">{[s.city, s.province].filter(Boolean).join(', ')}</span>
              <span className="text-stone">{s.stylist_type === 'salon' ? 'Salon stylist' : 'Freelance stylist'}</span>
              {s.years_experience > 0 && <span className="text-stone">{s.years_experience} years’ experience</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {modes.map((m) => (
                <Badge key={m}>{m}</Badge>
              ))}
              {s.offers_mobile && <Badge>Travels up to {s.max_travel_km} km</Badge>}
            </div>
          </div>
        </div>
        <div className="panel flex flex-col gap-3 self-start p-5">
          {s.is_accepting_bookings ? (
            <p className="text-sm text-stone">
              {s.booking_mode === 'instant' ? 'Most services confirm instantly.' : 'Requests are confirmed by the stylist, usually within a day.'}
            </p>
          ) : (
            <p className="text-sm text-warn">Not taking new bookings right now.</p>
          )}
          <Button href="#services" variant="accent">
            Choose a service
          </Button>
          {!isSelf && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={message} loading={messaging}>
                Message
              </Button>
              <Button variant="secondary" onClick={toggleFavorite} aria-pressed={Boolean(fav.data)}>
                {fav.data ? 'Saved' : 'Save'}
              </Button>
            </div>
          )}
          {isSelf && (
            <Button to="/stylist/profile" variant="secondary">
              Edit my profile
            </Button>
          )}
          {s.salons && (
            <div className="border-t border-sand pt-3 text-sm">
              <p className="font-medium">{s.salons.name}</p>
              <p className="text-stone">{[s.salons.address_line, s.salons.city].filter(Boolean).join(', ')}</p>
            </div>
          )}
        </div>
      </section>

      {s.bio && (
        <section className="mt-10 max-w-3xl">
          <h2 className="mb-3 text-2xl">About</h2>
          <p className="whitespace-pre-line leading-relaxed text-ink-soft">{s.bio}</p>
        </section>
      )}

      {/* Services */}
      <section id="services" className="mt-12 scroll-mt-24">
        <h2 className="mb-4 text-2xl">Services and prices</h2>
        {!s.services.length ? (
          <EmptyState title="No services listed yet" />
        ) : (
          <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper">
            {s.services.map((svc) => (
              <li key={svc.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link to={`/stylists/${s.id}/services/${svc.id}`} className="font-medium hover:text-brown">
                    {svc.title}
                  </Link>
                  <p className="text-sm text-stone">
                    {formatDuration(svc.duration_minutes)}
                    {svc.service_options?.some((o) => o.is_active) && ', options available'}
                  </p>
                  {svc.description && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{svc.description}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold">{formatMoney(svc.base_price_cents)}</span>
                  <Button to={`/book/${svc.id}`} size="sm" disabled={!s.is_accepting_bookings || isSelf}>
                    Book
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Portfolio */}
      {s.portfolio.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-2xl">Portfolio</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {s.portfolio.map((p) => (
              <button key={p.id} onClick={() => setLightbox(p)} className="group overflow-hidden rounded-[var(--radius-media)] border border-sand text-left">
                <img src={p.image_url} alt={p.caption || 'Portfolio photo'} loading="lazy" className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 text-2xl">Reviews</h2>
          {reviews.loading ? <LoadingState /> : <ReviewList reviews={reviews.data} stylistName={s.display_name} />}
        </section>
        <aside>
          <h2 className="mb-4 font-sans text-lg font-semibold">Working hours</h2>
          <p className="mb-3 text-xs text-stone">Shown in the stylist’s time zone ({s.timezone}).</p>
          <dl className="space-y-1.5 text-sm">
            {hoursByDay.map((d) => (
              <div key={d.name} className="flex justify-between gap-4">
                <dt className="text-stone">{d.name}</dt>
                <dd>{d.windows.length ? d.windows.map((w) => `${fmtTime(w.start_time)}–${fmtTime(w.end_time)}`).join(', ') : 'Closed'}</dd>
              </div>
            ))}
          </dl>
          {s.areas.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-sans text-sm font-semibold">Also travels to</h3>
              <ul className="text-sm text-stone">
                {s.areas.map((a) => (
                  <li key={a.id}>
                    {a.label} (within {a.radius_km} km)
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Portfolio photo" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => setLightbox(null)}>
          <figure className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.image_url} alt={lightbox.caption} className="max-h-[80vh] rounded-[var(--radius-media)]" />
            {lightbox.caption && <figcaption className="mt-3 text-center text-cream">{lightbox.caption}</figcaption>}
            <div className="mt-3 text-center">
              <Button variant="secondary" size="sm" onClick={() => setLightbox(null)} autoFocus>
                Close
              </Button>
            </div>
          </figure>
        </div>
      )}
    </div>
  )
}
