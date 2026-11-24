import { supabase, unwrap } from '../lib/supabase.js'

export const getCategories = async () =>
  unwrap(await supabase.from('service_categories').select('*').eq('is_active', true).order('sort_order'))

export const getCategoryBySlug = async (slug) =>
  unwrap(await supabase.from('service_categories').select('*, services(*)').eq('slug', slug).maybeSingle())

export const getCatalogServices = async () =>
  unwrap(
    await supabase
      .from('services')
      .select('id, slug, name, category_id, typical_duration_minutes, service_categories(name, slug)')
      .eq('is_active', true)
      .order('name'),
  )

/** Public platform settings as a { key: value } object. */
export async function getPublicSettings() {
  const rows = unwrap(await supabase.from('platform_settings').select('key, value'))
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
