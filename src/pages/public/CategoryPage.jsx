import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States.jsx'
import { StylistCard } from '../../components/stylists/StylistCard.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDuration } from '../../lib/pricing.js'
import { getCategoryBySlug } from '../../services/catalogService.js'
import { searchStylists } from '../../services/stylistService.js'

export default function CategoryPage() {
  const { slug } = useParams()
  const category = useAsync(() => getCategoryBySlug(slug), [slug])
  const stylists = useAsync(() => searchStylists({ category: slug, limit: 9 }), [slug])
  useDocumentTitle(category.data?.name)

  if (category.loading) return <LoadingState className="min-h-[50vh]" />
  if (category.error) return <div className="container-page py-10"><ErrorState error={category.error} onRetry={category.reload} /></div>
  if (!category.data)
    return (
      <div className="container-page py-16">
        <EmptyState title="Category not found" action={<Button to="/categories">See all styles</Button>} />
      </div>
    )

  const c = category.data
  return (
    <div className="container-page py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone">
        <Link to="/categories" className="hover:text-ink">Hairstyles</Link> / <span className="text-ink">{c.name}</span>
      </nav>
      <div className="grid gap-8 md:grid-cols-[1fr_320px] md:items-end">
        <div>
          <h1 className="text-4xl sm:text-5xl">{c.name}</h1>
          <p className="mt-3 max-w-2xl text-lg text-stone">{c.description}</p>
        </div>
        {c.image_url && <img src={c.image_url} alt="" className="hidden aspect-[4/3] w-full rounded-[var(--radius-media)] border border-sand object-cover md:block" />}
      </div>

      <section className="mt-10">
        <h2 className="mb-4 font-sans text-lg font-semibold">Styles in this category</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {c.services
            ?.filter((s) => s.is_active)
            .map((s) => (
              <li key={s.id}>
                <Link to={`/explore?service=${s.slug}`} className="panel block p-4 hover:border-brown">
                  <p className="font-medium">{s.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-stone">{s.description}</p>
                  <p className="mt-2 text-xs text-stone">Usually about {formatDuration(s.typical_duration_minutes)}</p>
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <section className="mt-14">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-sans text-lg font-semibold">Stylists offering {c.name.toLowerCase()}</h2>
          <Link className="link text-sm" to={`/explore?category=${c.slug}`}>
            Filter and compare
          </Link>
        </div>
        {stylists.loading ? (
          <LoadingState />
        ) : !stylists.data?.rows.length ? (
          <EmptyState title="No stylists offer this yet">New stylists join every week. Check back soon.</EmptyState>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {stylists.data.rows.map((s) => (
              <StylistCard key={s.stylist_id} s={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
