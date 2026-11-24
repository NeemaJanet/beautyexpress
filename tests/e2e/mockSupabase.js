// Network-level mock of the Supabase REST API for browser tests.
// Data is fictional and mirrors supabase/seed.sql.

export const STYLIST = {
  id: '50000000-0000-4000-8000-000000000001',
  display_name: 'Amara Demo',
  business_name: 'Amara Braids (sample)',
  headline: 'Knotless braids and cornrows',
  bio: 'Sample profile used for testing.',
  avatar_url: '/images/seed/avatar-1.svg',
  stylist_type: 'freelance',
  city: 'Fredericton',
  province: 'NB',
  years_experience: 8,
  offers_mobile: true,
  offers_studio: true,
  offers_salon: false,
  max_travel_km: 25,
  booking_mode: 'instant',
  timezone: 'America/Moncton',
  is_accepting_bookings: true,
  verification_status: 'verified',
  rating_avg: 5,
  rating_count: 1,
  salons: null,
}

const SERVICE = {
  id: '55000000-0000-4000-8000-000000000002',
  stylist_id: STYLIST.id,
  service_id: 's1',
  title: 'Straight-back cornrows',
  description: '8–12 cornrows.',
  base_price_cents: 6000,
  duration_minutes: 90,
  deposit_type: 'none',
  deposit_value: 0,
  booking_mode: null,
  location_types: ['client_location', 'stylist_studio'],
  is_active: true,
  services: { name: 'Cornrows', slug: 'cornrows', service_categories: { name: 'Braids', slug: 'braids' } },
  service_options: [],
}

const SEARCH_ROW = {
  stylist_id: STYLIST.id,
  display_name: STYLIST.display_name,
  business_name: STYLIST.business_name,
  headline: STYLIST.headline,
  avatar_url: STYLIST.avatar_url,
  cover_image_url: '/images/seed/braids.svg',
  city: 'Fredericton',
  province: 'NB',
  stylist_type: 'freelance',
  salon_name: null,
  offers_mobile: true,
  offers_studio: true,
  offers_salon: false,
  rating_avg: 5,
  rating_count: 1,
  is_featured: true,
  is_verified: true,
  distance_km: 1.2,
  from_price_cents: 6000,
  matching_services: ['Straight-back cornrows'],
  total_count: 1,
}

const CATEGORIES = [
  { id: 'c1', slug: 'braids', name: 'Braids', description: 'Box braids, knotless braids, cornrows and more.', image_url: '/images/seed/braids.svg', sort_order: 1, is_active: true },
  { id: 'c2', slug: 'locs', name: 'Locs', description: 'Starter locs and retwists.', image_url: '/images/seed/locs.svg', sort_order: 2, is_active: true },
]

const CATALOG = [
  { id: 's1', slug: 'cornrows', name: 'Cornrows', category_id: 'c1', typical_duration_minutes: 120, service_categories: { name: 'Braids', slug: 'braids' } },
  { id: 's2', slug: 'knotless-braids', name: 'Knotless braids', category_id: 'c1', typical_duration_minutes: 300, service_categories: { name: 'Braids', slug: 'braids' } },
]

/** Install the mock on a Playwright page. Records search calls for assertions. */
export async function mockSupabase(page) {
  const calls = { search: [] }
  await page.route('http://mock-supabase.test/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const list = (rows) => json(wantsObject ? rows[0] ?? null : rows)

    if (path.startsWith('/auth/v1/')) return json({})
    if (path.startsWith('/realtime/')) return route.abort()
    if (path === '/rest/v1/rpc/search_stylists') {
      calls.search.push(JSON.parse(req.postData() || '{}'))
      return json([SEARCH_ROW])
    }
    if (path === '/rest/v1/service_categories') {
      if (url.searchParams.get('slug')) return list([{ ...CATEGORIES[0], services: CATALOG.map((s) => ({ ...s, description: '', is_active: true })) }])
      return list(CATEGORIES)
    }
    if (path === '/rest/v1/services') return list(CATALOG)
    if (path === '/rest/v1/stylist_profiles') return list([STYLIST])
    if (path === '/rest/v1/stylist_services') return list([SERVICE])
    if (path === '/rest/v1/platform_settings') return list([{ key: 'support_email', value: 'support@example.com' }, { key: 'free_cancellation_hours', value: 24 }, { key: 'late_cancellation_fee_percent', value: 50 }])
    if (path === '/rest/v1/reviews') return list([{ id: 'r1', rating: 5, comment: 'SAMPLE REVIEW: lovely work', client_id: 'c1', created_at: '2026-10-01T12:00:00Z', stylist_reply: null }])
    if (path === '/rest/v1/public_profiles') return list([{ id: 'c1', display_name: 'Jordan C.', avatar_url: null }])
    if (['/rest/v1/stylist_portfolio', '/rest/v1/service_areas', '/rest/v1/stylist_availability'].includes(path)) return list([])
    return list([])
  })
  return calls
}
