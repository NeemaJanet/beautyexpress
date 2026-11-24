import { supabase, unwrap } from '../lib/supabase.js'

// ---------------------------------------------------------------------------
// Public discovery
// ---------------------------------------------------------------------------

/** Calls the search_stylists database function. All params optional. */
export async function searchStylists(p = {}) {
  const rows = unwrap(
    await supabase.rpc('search_stylists', {
      p_query: p.q || null,
      p_category_slug: p.category || null,
      p_service_slug: p.service || null,
      p_lat: p.lat ?? null,
      p_lng: p.lng ?? null,
      p_radius_km: p.radius ? Number(p.radius) : 50,
      p_min_price_cents: p.minPrice ? Math.round(Number(p.minPrice) * 100) : null,
      p_max_price_cents: p.maxPrice ? Math.round(Number(p.maxPrice) * 100) : null,
      p_min_rating: p.rating ? Number(p.rating) : null,
      p_location_mode: p.mode || 'any',
      p_stylist_type: p.type || null,
      p_available_on: p.date || null,
      p_featured_only: Boolean(p.featured),
      p_sort: p.sort || 'recommended',
      p_limit: p.limit || 24,
      p_offset: p.offset || 0,
    }),
  )
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 }
}

export async function getStylistPublic(id) {
  const profile = unwrap(
    await supabase
      .from('stylist_profiles')
      .select('*, salons!stylist_profiles_salon_id_fkey(id, name, address_line, city, province, postal_code)')
      .eq('id', id)
      .maybeSingle(),
  )
  if (!profile) return null
  const [services, portfolio, areas, hours] = await Promise.all([
    supabase
      .from('stylist_services')
      .select('*, services(name, slug, service_categories(name, slug)), service_options(*)')
      .eq('stylist_id', id)
      .eq('is_active', true)
      .order('base_price_cents'),
    supabase.from('stylist_portfolio').select('*').eq('stylist_id', id).order('sort_order').order('created_at'),
    supabase.from('service_areas').select('*').eq('stylist_id', id),
    supabase.from('stylist_availability').select('*').eq('stylist_id', id).order('weekday').order('start_time'),
  ])
  return {
    ...profile,
    services: unwrap(services),
    portfolio: unwrap(portfolio),
    areas: unwrap(areas),
    hours: unwrap(hours),
  }
}

export async function getStylistReviews(stylistId, limit = 20) {
  const reviews = unwrap(
    await supabase
      .from('reviews')
      .select('id, rating, comment, stylist_reply, replied_at, created_at, client_id, booking_id')
      .eq('stylist_id', stylistId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  const ids = [...new Set(reviews.map((r) => r.client_id))]
  const names = ids.length
    ? unwrap(await supabase.from('public_profiles').select('id, display_name, avatar_url').in('id', ids))
    : []
  const byId = Object.fromEntries(names.map((n) => [n.id, n]))
  return reviews.map((r) => ({ ...r, author: byId[r.client_id] || { display_name: 'Client' } }))
}

export async function getStylistService(serviceId) {
  return unwrap(
    await supabase
      .from('stylist_services')
      .select(
        '*, services(name, slug, description, service_categories(name, slug)), service_options(*), stylist_profiles(id, display_name, business_name, avatar_url, city, province, rating_avg, rating_count, booking_mode, stylist_type, offers_mobile, offers_studio, offers_salon, timezone, salon_id, salons!stylist_profiles_salon_id_fkey(name, address_line, city))',
      )
      .eq('id', serviceId)
      .maybeSingle(),
  )
}

// ---------------------------------------------------------------------------
// Favorites (clients)
// ---------------------------------------------------------------------------
export const listFavorites = async (clientId) =>
  unwrap(
    await supabase
      .from('favorites')
      .select('stylist_id, created_at, stylist_profiles(id, display_name, business_name, headline, avatar_url, city, rating_avg, rating_count)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),
  )

export async function isFavorite(clientId, stylistId) {
  const { data } = await supabase.from('favorites').select('stylist_id').eq('client_id', clientId).eq('stylist_id', stylistId)
  return Boolean(data?.length)
}

export async function setFavorite(clientId, stylistId, on) {
  if (on) unwrap(await supabase.from('favorites').insert({ client_id: clientId, stylist_id: stylistId }))
  else unwrap(await supabase.from('favorites').delete().eq('client_id', clientId).eq('stylist_id', stylistId))
}

// ---------------------------------------------------------------------------
// Stylist self-management (RLS limits every call to the signed-in stylist)
// ---------------------------------------------------------------------------
export const getMyStylistProfile = async (id) =>
  unwrap(await supabase.from('stylist_profiles').select('*, salons!stylist_profiles_salon_id_fkey(*)').eq('id', id).single())

export const updateStylistProfile = async (id, fields) =>
  unwrap(await supabase.from('stylist_profiles').update(fields).eq('id', id).select().single())

export const getMyStylistPrivate = async (id) =>
  unwrap(await supabase.from('stylist_private').select('*').eq('stylist_id', id).single())

export const updateStylistPrivate = async (id, fields) =>
  unwrap(await supabase.from('stylist_private').update(fields).eq('stylist_id', id).select().single())

export const listMyServices = async (stylistId) =>
  unwrap(
    await supabase
      .from('stylist_services')
      .select('*, services(name, slug), service_options(*)')
      .eq('stylist_id', stylistId)
      .order('created_at'),
  )

export const saveService = async (stylistId, service) => {
  const row = { ...service, stylist_id: stylistId }
  delete row.service_options
  delete row.services
  if (row.id) {
    const id = row.id
    delete row.id
    return unwrap(await supabase.from('stylist_services').update(row).eq('id', id).select().single())
  }
  return unwrap(await supabase.from('stylist_services').insert(row).select().single())
}

export const deleteService = async (id) => unwrap(await supabase.from('stylist_services').delete().eq('id', id))

export const saveOption = async (option) => {
  const row = { ...option }
  if (row.id) {
    const id = row.id
    delete row.id
    return unwrap(await supabase.from('service_options').update(row).eq('id', id).select().single())
  }
  return unwrap(await supabase.from('service_options').insert(row).select().single())
}

export const deleteOption = async (id) => unwrap(await supabase.from('service_options').delete().eq('id', id))

export const listPortfolio = async (stylistId) =>
  unwrap(await supabase.from('stylist_portfolio').select('*').eq('stylist_id', stylistId).order('sort_order').order('created_at'))

export const addPortfolioItem = async (item) => unwrap(await supabase.from('stylist_portfolio').insert(item).select().single())
export const updatePortfolioItem = async (id, fields) =>
  unwrap(await supabase.from('stylist_portfolio').update(fields).eq('id', id).select().single())
export const deletePortfolioItem = async (id) => unwrap(await supabase.from('stylist_portfolio').delete().eq('id', id))

export const listAreas = async (stylistId) => unwrap(await supabase.from('service_areas').select('*').eq('stylist_id', stylistId))
export const addArea = async (area) => unwrap(await supabase.from('service_areas').insert(area).select().single())
export const deleteArea = async (id) => unwrap(await supabase.from('service_areas').delete().eq('id', id))

export const listAvailability = async (stylistId) =>
  unwrap(await supabase.from('stylist_availability').select('*').eq('stylist_id', stylistId).order('weekday').order('start_time'))

/** Replace all windows for one weekday. */
export async function replaceDayWindows(stylistId, weekday, windows) {
  unwrap(await supabase.from('stylist_availability').delete().eq('stylist_id', stylistId).eq('weekday', weekday))
  if (windows.length) {
    unwrap(
      await supabase
        .from('stylist_availability')
        .insert(windows.map((w) => ({ stylist_id: stylistId, weekday, start_time: w.start_time, end_time: w.end_time }))),
    )
  }
}

export const listExceptions = async (stylistId) =>
  unwrap(
    await supabase
      .from('availability_exceptions')
      .select('*')
      .eq('stylist_id', stylistId)
      .gte('ends_at', new Date().toISOString())
      .order('starts_at'),
  )
export const addException = async (row) => unwrap(await supabase.from('availability_exceptions').insert(row).select().single())
export const deleteException = async (id) => unwrap(await supabase.from('availability_exceptions').delete().eq('id', id))

// Salons
export const searchSalons = async (text) =>
  unwrap(
    await supabase
      .from('salons')
      .select('*')
      .or(`name.ilike.%${text.replace(/[%_,()]/g, '')}%,city.ilike.%${text.replace(/[%_,()]/g, '')}%`)
      .limit(10),
  )

export async function createSalon(stylistId, salon) {
  const created = unwrap(await supabase.from('salons').insert({ ...salon, created_by: stylistId }).select().single())
  unwrap(await supabase.from('salon_memberships').insert({ salon_id: created.id, stylist_id: stylistId, member_role: 'owner' }))
  return created
}

export async function joinSalon(stylistId, salonId) {
  const { error } = await supabase.from('salon_memberships').insert({ salon_id: salonId, stylist_id: stylistId })
  if (error && error.code !== '23505') throw error
}
