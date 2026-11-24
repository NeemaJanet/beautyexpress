import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { supabase, unwrap } from '../../lib/supabase.js'

export default function CategoriesPage() {
  useDocumentTitle('Hairstyles')
  const { data, loading, error, reload } = useAsync(
    async () =>
      unwrap(
        await supabase
          .from('service_categories')
          .select('*, services(id, slug, name, is_active)')
          .eq('is_active', true)
          .order('sort_order'),
      ),
    [],
  )

  return (
    <div className="container-page py-10">
      <PageHeader title="Hairstyles" description="Choose a style to see who offers it, their prices and their work." />
      <AsyncBoundary loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState title="No categories yet" />}>
        <div className="space-y-12">
          {data?.map((c) => (
            <section key={c.id} className="grid gap-6 border-t border-sand pt-8 md:grid-cols-[220px_1fr]">
              <Link to={`/categories/${c.slug}`} className="group">
                <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-media)] border border-sand bg-sand-soft">
                  {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
              </Link>
              <div>
                <h2 className="text-2xl">
                  <Link to={`/categories/${c.slug}`} className="hover:text-brown">
                    {c.name}
                  </Link>
                </h2>
                <p className="mt-1 text-stone">{c.description}</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {c.services
                    ?.filter((s) => s.is_active)
                    .map((s) => (
                      <li key={s.id}>
                        <Link to={`/explore?service=${s.slug}`} className="inline-block rounded-full border border-sand bg-paper px-4 py-1.5 text-sm hover:border-brown">
                          {s.name}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      </AsyncBoundary>
    </div>
  )
}
