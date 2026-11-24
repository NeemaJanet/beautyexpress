import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { Input, Select } from '../../components/common/Field.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States.jsx'
import { LocationPicker } from '../../components/forms/LocationPicker.jsx'
import { StylistCard } from '../../components/stylists/StylistCard.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { getCatalogServices, getCategories } from '../../services/catalogService.js'
import { searchStylists } from '../../services/stylistService.js'

const PAGE = 12
const FILTER_KEYS = ['q', 'category', 'service', 'lat', 'lng', 'place', 'radius', 'mode', 'type', 'rating', 'minPrice', 'maxPrice', 'date', 'sort']

/** Explore stylists = the search results page. All filters live in the URL, so results can be shared. */
export default function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const [limit, setLimit] = useState(PAGE)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params])
  useDocumentTitle(filters.q || filters.service ? 'Search results' : 'Find a stylist')

  const categories = useAsync(getCategories, [])
  const services = useAsync(getCatalogServices, [])
  const results = useAsync(
    () =>
      searchStylists({
        ...filters,
        lat: filters.lat ? Number(filters.lat) : null,
        lng: filters.lng ? Number(filters.lng) : null,
        limit,
      }),
    [params.toString(), limit],
  )

  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === '' || v == null) next.delete(k)
      else next.set(k, v)
    }
    setLimit(PAGE)
    setParams(next, { replace: true })
  }

  const location = filters.lat && filters.lng ? { label: filters.place || 'Selected location', lat: Number(filters.lat), lng: Number(filters.lng) } : null
  const serviceOptions = (services.data || [])
    .filter((s) => !filters.category || s.service_categories?.slug === filters.category)
    .map((s) => ({ value: s.slug, label: s.name }))
  const activeCount = FILTER_KEYS.filter((k) => !['sort', 'place', 'lng'].includes(k) && filters[k]).length
  const today = new Date().toISOString().slice(0, 10)

  const filterPanel = (
    <div className="space-y-5">
      <Input label="Search" type="search" placeholder="Name, style or neighbourhood" defaultValue={filters.q} key={`q-${filters.q}`}
        onKeyDown={(e) => e.key === 'Enter' && update({ q: e.currentTarget.value.trim() })}
        onBlur={(e) => e.target.value.trim() !== filters.q && update({ q: e.target.value.trim() })} />
      <div>
        <label className="label" htmlFor="explore-location">Location</label>
        <LocationPicker
          id="explore-location"
          value={location}
          onChange={(loc) => update(loc ? { lat: loc.lat.toFixed(4), lng: loc.lng.toFixed(4), place: loc.label } : { lat: '', lng: '', place: '' })}
        />
      </div>
      {location && (
        <Select label="Distance" value={filters.radius || '50'} onChange={(e) => update({ radius: e.target.value })}
          options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: `Within ${n} km` }))} />
      )}
      <Select label="Where" value={filters.mode} onChange={(e) => update({ mode: e.target.value })} placeholder="Anywhere"
        options={[{ value: 'mobile', label: 'Stylist comes to me' }, { value: 'studio', label: "Stylist's studio" }, { value: 'salon', label: 'Salon' }]} />
      <Select label="Category" value={filters.category} onChange={(e) => update({ category: e.target.value, service: '' })} placeholder="All categories"
        options={(categories.data || []).map((c) => ({ value: c.slug, label: c.name }))} />
      <Select label="Hairstyle" value={filters.service} onChange={(e) => update({ service: e.target.value })} placeholder="Any hairstyle" options={serviceOptions} />
      <Select label="Stylist type" value={filters.type} onChange={(e) => update({ type: e.target.value })} placeholder="Freelance or salon"
        options={[{ value: 'freelance', label: 'Freelance stylists' }, { value: 'salon', label: 'Salon stylists' }]} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Min price ($)" type="number" min="0" inputMode="decimal" defaultValue={filters.minPrice} key={`min-${filters.minPrice}`}
          onBlur={(e) => e.target.value !== filters.minPrice && update({ minPrice: e.target.value })} />
        <Input label="Max price ($)" type="number" min="0" inputMode="decimal" defaultValue={filters.maxPrice} key={`max-${filters.maxPrice}`}
          onBlur={(e) => e.target.value !== filters.maxPrice && update({ maxPrice: e.target.value })} />
      </div>
      <Select label="Rating" value={filters.rating} onChange={(e) => update({ rating: e.target.value })} placeholder="Any rating"
        options={[{ value: '4.5', label: '4.5 and up' }, { value: '4', label: '4 and up' }, { value: '3', label: '3 and up' }]} />
      <Input label="Available on" type="date" min={today} value={filters.date} onChange={(e) => update({ date: e.target.value })}
        hint="Shows stylists who work that day." />
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
          Clear all filters
        </Button>
      )}
    </div>
  )

  return (
    <div className="container-page py-10">
      <PageHeader
        title={filters.q ? `Results for “${filters.q}”` : 'Find a stylist'}
        description={location ? `Near ${location.label}` : 'Add your location to see who is nearby and who can come to you.'}
      />
      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside>
          <Button variant="secondary" className="mb-4 w-full lg:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
            {filtersOpen ? 'Hide filters' : `Filters${activeCount ? ` (${activeCount})` : ''}`}
          </Button>
          <div className={`${filtersOpen ? 'block' : 'hidden'} lg:block`}>{filterPanel}</div>
        </aside>

        <section aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone">
              {results.loading ? 'Searching…' : `${results.data?.total ?? 0} stylist${results.data?.total === 1 ? '' : 's'}`}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-stone">Sort by</span>
              <select className="control w-auto py-1.5" value={filters.sort || 'recommended'} onChange={(e) => update({ sort: e.target.value })}>
                <option value="recommended">Recommended</option>
                <option value="rating">Highest rated</option>
                <option value="price_low">Price: low to high</option>
                <option value="price_high">Price: high to low</option>
                <option value="distance" disabled={!location}>Distance</option>
              </select>
            </label>
          </div>

          {results.error ? (
            <ErrorState error={results.error} onRetry={results.reload} />
          ) : results.loading && !results.data ? (
            <LoadingState />
          ) : !results.data?.rows.length ? (
            <EmptyState title="No stylists match these filters" action={<Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>}>
              Try a wider distance, another date, or fewer filters.
            </EmptyState>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {results.data.rows.map((s) => (
                  <StylistCard key={s.stylist_id} s={s} />
                ))}
              </div>
              {results.data.total > results.data.rows.length && (
                <div className="mt-8 text-center">
                  <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)} loading={results.loading}>
                    Show more stylists
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
