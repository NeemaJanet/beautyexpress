import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { LOCATION_LABELS } from '../../lib/bookingStatus.js'
import { describeDeposit, formatDuration, formatMoney } from '../../lib/pricing.js'
import { getStylistService } from '../../services/stylistService.js'

export default function ServiceDetailPage() {
  const { id, serviceId } = useParams()
  const { data: svc, loading } = useAsync(() => getStylistService(serviceId), [serviceId])
  useDocumentTitle(svc?.title)

  if (loading) return <LoadingState className="min-h-[50vh]" />
  if (!svc || svc.stylist_id !== id || !svc.is_active)
    return (
      <div className="container-page py-16">
        <EmptyState title="This service is not available" action={<Button to={`/stylists/${id}`}>See the stylist’s other services</Button>} />
      </div>
    )

  const sp = svc.stylist_profiles
  const groups = Object.entries(
    (svc.service_options || [])
      .filter((o) => o.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .reduce((acc, o) => ({ ...acc, [o.group_name]: [...(acc[o.group_name] || []), o] }), {}),
  )

  return (
    <div className="container-page py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone">
        <Link to={`/stylists/${id}`} className="hover:text-ink">{sp.display_name}</Link> / <span className="text-ink">{svc.title}</span>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <h1 className="text-4xl">{svc.title}</h1>
          <p className="mt-2 text-stone">{svc.services?.service_categories?.name}: {svc.services?.name}</p>
          {svc.description && <p className="mt-6 max-w-2xl whitespace-pre-line leading-relaxed text-ink-soft">{svc.description}</p>}
          {svc.services?.description && <p className="mt-4 max-w-2xl text-sm text-stone">{svc.services.description}</p>}

          {groups.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 font-sans text-lg font-semibold">Options</h2>
              <div className="space-y-6">
                {groups.map(([group, opts]) => (
                  <div key={group}>
                    <p className="mb-2 text-sm font-medium">
                      {group} <span className="text-stone">({opts[0].group_type === 'choose_one' ? 'choose one' : 'optional extras'})</span>
                    </p>
                    <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper text-sm">
                      {opts.map((o) => (
                        <li key={o.id} className="flex justify-between gap-4 px-4 py-3">
                          <span>{o.name}</span>
                          <span className="text-stone">
                            {o.price_delta_cents === 0 ? 'Included' : `${o.price_delta_cents > 0 ? '+' : '−'}${formatMoney(Math.abs(o.price_delta_cents))}`}
                            {o.duration_delta_minutes !== 0 && `, ${o.duration_delta_minutes > 0 ? '+' : '−'}${formatDuration(Math.abs(o.duration_delta_minutes))}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="panel self-start p-6">
          <p className="text-sm text-stone">Starting at</p>
          <p className="font-display text-4xl">{formatMoney(svc.base_price_cents)}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-stone">Time</dt><dd>{formatDuration(svc.duration_minutes)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone">Payment</dt><dd>{describeDeposit(svc.deposit_type, svc.deposit_value)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone">Booking</dt><dd>{(svc.booking_mode || sp.booking_mode) === 'instant' ? 'Instant confirmation' : 'Stylist confirms'}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {svc.location_types.map((l) => <Badge key={l}>{LOCATION_LABELS[l]}</Badge>)}
          </div>
          <Button to={`/book/${svc.id}`} variant="accent" size="lg" className="mt-6 w-full">
            Choose a time
          </Button>
          <p className="mt-3 text-xs text-stone">Taxes, booking fee and any travel fee are shown before you confirm.</p>
          <Link to={`/stylists/${id}`} className="mt-6 flex items-center gap-3 border-t border-sand pt-4">
            <Avatar src={sp.avatar_url} name={sp.display_name} size="sm" />
            <div className="text-sm">
              <p className="font-medium">{sp.display_name}</p>
              <RatingStars value={sp.rating_avg} count={sp.rating_count} />
            </div>
          </Link>
        </aside>
      </div>
    </div>
  )
}
