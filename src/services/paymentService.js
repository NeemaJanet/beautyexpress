import { callFunction, supabase, unwrap } from '../lib/supabase.js'

/** Server creates the PaymentIntent for the amount the database says is due. */
export const createPaymentIntent = (bookingId) => callFunction('create-payment-intent', { booking_id: bookingId })

export const markEtransferSent = async (paymentId) => unwrap(await supabase.rpc('mark_etransfer_sent', { p_payment_id: paymentId }))

export const markPaidInPerson = async (paymentId) =>
  unwrap(await supabase.rpc('stylist_mark_paid_in_person', { p_payment_id: paymentId }))

export const listMyPayments = async (clientId) =>
  unwrap(
    await supabase
      .from('payments')
      .select('*, bookings(id, reference, starts_at, stylist_services(title), stylist_profiles(display_name))')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),
  )

export const listMyRefunds = async () =>
  unwrap(
    await supabase
      .from('refunds')
      .select('*, bookings(reference, stylist_services(title))')
      .order('created_at', { ascending: false }),
  )

export const listStylistPayouts = async (stylistId) =>
  unwrap(
    await supabase
      .from('payouts')
      .select('*, bookings(reference, starts_at, stylist_services(title))')
      .eq('stylist_id', stylistId)
      .order('created_at', { ascending: false }),
  )

/** Stripe Connect: 'onboard' | 'refresh' | 'dashboard' */
export const stripeConnect = (action) => callFunction('stripe-connect', { action })
