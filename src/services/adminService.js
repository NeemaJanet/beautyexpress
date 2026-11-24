// Administrator data access. Every call is re-checked in the database
// (is_admin() in RLS policies and admin_* functions).
import { callFunction, supabase, unwrap } from '../lib/supabase.js'
import { escapeLike } from '../lib/validation.js'

export const getStats = async () => unwrap(await supabase.rpc('admin_stats'))

export async function listUsers({ search = '', status = '', page = 0, pageSize = 25 }) {
  let q = supabase
    .from('profiles')
    .select('id, full_name, email, phone, status, status_reason, created_at, user_roles!user_roles_user_id_fkey(role)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (search) q = q.or(`full_name.ilike.%${escapeLike(search)}%,email.ilike.%${escapeLike(search)}%`)
  if (status) q = q.eq('status', status)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data, count }
}

export const setUserStatus = async (userId, status, reason) =>
  unwrap(await supabase.rpc('admin_set_user_status', { p_user_id: userId, p_status: status, p_reason: reason || null }))

export const setUserRole = async (userId, role, grant) =>
  unwrap(await supabase.rpc('admin_set_role', { p_user_id: userId, p_role: role, p_grant: grant }))

export async function listStylists({ approval = '', search = '' }) {
  let q = supabase
    .from('stylist_profiles')
    .select('id, display_name, business_name, city, province, stylist_type, verification_status, approval_status, is_featured, onboarding_completed, rating_avg, rating_count, created_at, profiles!stylist_profiles_id_fkey(email, status)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (approval) q = q.eq('approval_status', approval)
  if (search) q = q.or(`display_name.ilike.%${escapeLike(search)}%,business_name.ilike.%${escapeLike(search)}%,city.ilike.%${escapeLike(search)}%`)
  return unwrap(await q)
}

export const updateStylist = async (id, { verification, approval, featured }) =>
  unwrap(
    await supabase.rpc('admin_update_stylist', {
      p_stylist_id: id,
      p_verification: verification ?? null,
      p_approval: approval ?? null,
      p_featured: featured ?? null,
    }),
  )

export async function listAllBookings({ status = '', search = '', page = 0, pageSize = 25 }) {
  let q = supabase
    .from('bookings')
    .select('id, reference, status, starts_at, total_cents, amount_paid_cents, payment_provider, currency, client_id, stylist_services(title), stylist_profiles(display_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (status) q = q.eq('status', status)
  if (search) q = q.ilike('reference', `%${escapeLike(search.toUpperCase())}%`)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data, count }
}

export async function listPayments({ status = '', provider = '' }) {
  let q = supabase
    .from('payments')
    .select('*, bookings(reference)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)
  if (provider) q = q.eq('provider', provider)
  return unwrap(await q)
}

export const listRefunds = async () =>
  unwrap(await supabase.from('refunds').select('*, bookings(reference), payments(provider)').order('created_at', { ascending: false }).limit(200))

export const listPayouts = async () =>
  unwrap(
    await supabase.from('payouts').select('*, bookings(reference), stylist_profiles(display_name)').order('created_at', { ascending: false }).limit(200),
  )

export const verifyManualPayment = async (paymentId, approved, note) =>
  unwrap(await supabase.rpc('admin_verify_manual_payment', { p_payment_id: paymentId, p_approved: approved, p_note: note || null }))

export const markRefundCompleted = async (refundId, note) =>
  unwrap(await supabase.rpc('admin_mark_refund_completed', { p_refund_id: refundId, p_note: note || null }))

export const retryRefund = (refundId) => callFunction('process-refund', { refund_id: refundId, retry: true })
export const processBookingRefunds = (bookingId) => callFunction('process-refund', { booking_id: bookingId })
export const retryPayout = async (payoutId) => unwrap(await supabase.rpc('admin_retry_payout', { p_payout_id: payoutId }))
export const releasePayouts = () => callFunction('release-payouts', {})
export const runNotificationJob = () => callFunction('send-notification', {})

export const listReports = async (status = '') => {
  let q = supabase
    .from('reports')
    .select('*, reporter:profiles!reports_reporter_id_fkey(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)
  return unwrap(await q)
}

export const respondToReport = async (id, status, response) =>
  unwrap(await supabase.rpc('admin_respond_report', { p_report_id: id, p_status: status, p_response: response || null }))

export const listDisputes = async (status = '') => {
  let q = supabase
    .from('disputes')
    .select('*, bookings(id, reference, total_cents, amount_paid_cents, amount_refunded_cents, currency, payment_provider)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)
  return unwrap(await q)
}

export const updateDispute = async (id, status, notes, refundCents) =>
  unwrap(
    await supabase.rpc('admin_update_dispute', {
      p_dispute_id: id,
      p_status: status,
      p_notes: notes || null,
      p_refund_cents: refundCents || 0,
    }),
  )

// Catalogue
export const listAllCategories = async () =>
  unwrap(await supabase.from('service_categories').select('*, services(*)').order('sort_order'))
export const saveCategory = async (row) =>
  row.id
    ? unwrap(await supabase.from('service_categories').update(row).eq('id', row.id).select().single())
    : unwrap(await supabase.from('service_categories').insert(row).select().single())
export const saveCatalogService = async (row) =>
  row.id
    ? unwrap(await supabase.from('services').update(row).eq('id', row.id).select().single())
    : unwrap(await supabase.from('services').insert(row).select().single())

// Settings & promo codes
export const listSettings = async () => unwrap(await supabase.from('platform_settings').select('*').order('key'))
export const updateSetting = async (key, value) => unwrap(await supabase.rpc('admin_update_setting', { p_key: key, p_value: value }))

export const listPromoCodes = async () => unwrap(await supabase.from('promo_codes').select('*').order('created_at', { ascending: false }))
export const savePromoCode = async (row) =>
  row.id
    ? unwrap(await supabase.from('promo_codes').update(row).eq('id', row.id).select().single())
    : unwrap(await supabase.from('promo_codes').insert(row).select().single())

export const setReviewHidden = async (id, hidden) =>
  unwrap(await supabase.from('reviews').update({ is_hidden: hidden }).eq('id', id))

export async function listAuditLogs({ page = 0, pageSize = 50, table = '' }) {
  let q = supabase
    .from('audit_logs')
    .select('*, actor:profiles!audit_logs_actor_id_fkey(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (table) q = q.eq('table_name', table)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data, count }
}
