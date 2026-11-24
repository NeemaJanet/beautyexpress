import { callFunction, supabase, unwrap } from '../lib/supabase.js'

/** Authoritative price breakdown from the database. */
export const getQuote = async ({ serviceId, optionIds = [], locationType, lat = null, lng = null, promoCode = null }) =>
  unwrap(
    await supabase.rpc('quote_booking', {
      p_stylist_service_id: serviceId,
      p_option_ids: optionIds,
      p_location_type: locationType,
      p_client_lat: lat,
      p_client_lng: lng,
      p_promo_code: promoCode || null,
    }),
  )

/** Free start times for one calendar day (YYYY-MM-DD, stylist's time zone). */
export const getSlots = async ({ serviceId, date, optionIds = [], excludeBookingId = null }) =>
  unwrap(
    await supabase.rpc('get_available_slots', {
      p_stylist_service_id: serviceId,
      p_date: date,
      p_option_ids: optionIds,
      p_exclude_booking_id: excludeBookingId,
    }),
  )

export const createBooking = async (b) =>
  unwrap(
    await supabase.rpc('create_booking', {
      p_stylist_service_id: b.serviceId,
      p_option_ids: b.optionIds,
      p_starts_at: b.startsAt,
      p_location_type: b.locationType,
      p_address_id: b.addressId || null,
      p_client_notes: b.notes || null,
      p_promo_code: b.promoCode || null,
      p_payment_provider: b.paymentProvider || null,
      p_contact_phone: b.contactPhone || null,
    }),
  )

const BOOKING_SELECT =
  '*, stylist_services(id, title, duration_minutes), stylist_profiles(id, display_name, business_name, avatar_url, city, timezone), salons(name, address_line, city)'

export async function getBooking(id) {
  const booking = unwrap(await supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).maybeSingle())
  if (!booking) return null
  const [items, history, payments, refunds, review, disputes, client] = await Promise.all([
    supabase.from('booking_line_items').select('*').eq('booking_id', id).order('sort_order'),
    supabase.from('booking_status_history').select('*').eq('booking_id', id).order('created_at'),
    supabase.from('payments').select('*').eq('booking_id', id).order('created_at'),
    supabase.from('refunds').select('*').eq('booking_id', id).order('created_at'),
    supabase.from('reviews').select('*').eq('booking_id', id).maybeSingle(),
    supabase.from('disputes').select('*').eq('booking_id', id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, avatar_url, phone').eq('id', booking.client_id).maybeSingle(),
  ])
  return {
    ...booking,
    line_items: unwrap(items),
    history: unwrap(history),
    payments: unwrap(payments),
    refunds: unwrap(refunds),
    review: review.data,
    disputes: unwrap(disputes),
    client: client.data,
  }
}

/** Bookings where the signed-in user is the client or the stylist. */
export async function listBookings({ as, userId, statuses, from, to, limit = 100, ascending = true }) {
  let q = supabase
    .from('bookings')
    .select(`${BOOKING_SELECT}, profiles:client_id(full_name, avatar_url)`)
    .eq(as === 'stylist' ? 'stylist_id' : 'client_id', userId)
    .order('starts_at', { ascending })
    .limit(limit)
  if (statuses?.length) q = q.in('status', statuses)
  if (from) q = q.gte('starts_at', from)
  if (to) q = q.lt('starts_at', to)
  return unwrap(await q)
}

export const getBookingLocation = async (id) => unwrap(await supabase.rpc('get_booking_location', { p_booking_id: id }))

export const transitionBooking = async (id, to, reason) =>
  unwrap(await supabase.rpc('transition_booking', { p_booking_id: id, p_to: to, p_reason: reason || null }))

export const cancellationPreview = async (id) => unwrap(await supabase.rpc('cancellation_preview', { p_booking_id: id }))

/**
 * Cancel or decline. Bookings with online card payments go through the
 * cancel-booking Edge Function so the refund is sent to Stripe immediately.
 */
export async function cancelBooking(booking, { reason, action = 'cancel' }) {
  const paidByCard = booking.payment_provider === 'stripe' && booking.amount_paid_cents > 0
  if (paidByCard) return callFunction('cancel-booking', { booking_id: booking.id, action, reason })
  if (action === 'decline') return transitionBooking(booking.id, 'declined', reason)
  return unwrap(await supabase.rpc('cancel_booking', { p_booking_id: booking.id, p_reason: reason || null }))
}

export const rescheduleBooking = async (id, newStart, reason) =>
  unwrap(await supabase.rpc('reschedule_booking', { p_booking_id: id, p_new_start: newStart, p_reason: reason || null }))

export const submitReview = async ({ bookingId, clientId, rating, comment }) =>
  unwrap(
    await supabase
      .from('reviews')
      .insert({ booking_id: bookingId, client_id: clientId, rating, comment: comment?.trim() || '' })
      .select()
      .single(),
  )

export const updateReview = async (id, { rating, comment }) =>
  unwrap(await supabase.from('reviews').update({ rating, comment }).eq('id', id).select().single())

export const replyToReview = async (id, reply) => unwrap(await supabase.rpc('reply_to_review', { p_review_id: id, p_reply: reply }))

export const openDispute = async (bookingId, reason, description) =>
  unwrap(await supabase.rpc('open_dispute', { p_booking_id: bookingId, p_reason: reason, p_description: description }))

export const respondToDispute = async (id, response) =>
  unwrap(await supabase.rpc('respond_to_dispute', { p_dispute_id: id, p_response: response }))

export const listMyReviews = async (clientId) =>
  unwrap(
    await supabase
      .from('reviews')
      .select('*, stylist_profiles(display_name, business_name), bookings(starts_at, stylist_services(title))')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),
  )

/** Completed bookings the client has not reviewed yet. */
export async function listBookingsToReview(clientId) {
  const rows = unwrap(
    await supabase
      .from('bookings')
      .select('id, starts_at, completed_at, stylist_services(title), stylist_profiles(display_name), reviews(id)')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50),
  )
  return rows.filter((b) => !b.reviews || (Array.isArray(b.reviews) ? b.reviews.length === 0 : !b.reviews.id))
}
