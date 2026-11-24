/**
 * Booking statuses and the actions each person can take.
 *
 * The database (functions transition_booking / cancel_booking) enforces these
 * rules. This file only decides which buttons to SHOW; if it were wrong, the
 * server would still reject the change.
 */

export const STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  requested: 'Requested',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  cancelled_by_client: 'Cancelled by client',
  cancelled_by_stylist: 'Cancelled by stylist',
  cancelled_by_admin: 'Cancelled by BeautyExpress',
  expired: 'Expired',
  no_show: 'No-show',
}

export const STATUS_TONES = {
  pending_payment: 'amber',
  requested: 'amber',
  confirmed: 'green',
  in_progress: 'blue',
  completed: 'gray',
  declined: 'red',
  cancelled_by_client: 'red',
  cancelled_by_stylist: 'red',
  cancelled_by_admin: 'red',
  expired: 'gray',
  no_show: 'red',
}

export const ACTIVE_STATUSES = ['pending_payment', 'requested', 'confirmed', 'in_progress']
export const UPCOMING_STATUSES = ['pending_payment', 'requested', 'confirmed', 'in_progress']
export const PAST_STATUSES = ['completed', 'no_show']
export const CANCELLED_STATUSES = [
  'declined',
  'cancelled_by_client',
  'cancelled_by_stylist',
  'cancelled_by_admin',
  'expired',
]

/** Stylist transitions: from -> allowed next statuses. Mirrors transition_booking(). */
export const STYLIST_TRANSITIONS = {
  requested: ['confirmed', 'declined'],
  confirmed: ['in_progress', 'no_show'],
  in_progress: ['completed'],
}

export const CANCELLABLE_STATUSES = ['pending_payment', 'requested', 'confirmed']
export const RESCHEDULABLE_STATUSES = ['requested', 'confirmed']

export function canTransition(from, to) {
  return (STYLIST_TRANSITIONS[from] || []).includes(to)
}

/**
 * Which actions should be offered to the current viewer?
 * @param {object} booking  row from the bookings table
 * @param {'client'|'stylist'|'admin'} viewer
 * @param {Date} now
 */
export function availableActions(booking, viewer, now = new Date()) {
  const actions = []
  const start = new Date(booking.starts_at)
  const status = booking.status

  if (viewer === 'stylist' || viewer === 'admin') {
    if (status === 'requested') actions.push('accept', 'decline')
    if (status === 'confirmed' && (viewer === 'admin' || now >= new Date(start.getTime() - 60 * 60 * 1000)))
      actions.push('start')
    if (status === 'confirmed' && (viewer === 'admin' || now >= new Date(start.getTime() + 15 * 60 * 1000)))
      actions.push('no_show')
    if (status === 'in_progress') actions.push('complete')
  }
  if (viewer === 'client' && status === 'pending_payment') actions.push('pay')
  if (CANCELLABLE_STATUSES.includes(status)) actions.push('cancel')
  if (RESCHEDULABLE_STATUSES.includes(status) && start > now) actions.push('reschedule')
  return actions
}

export const ACTION_TO_STATUS = {
  accept: 'confirmed',
  decline: 'declined',
  start: 'in_progress',
  complete: 'completed',
  no_show: 'no_show',
}

export const LOCATION_LABELS = {
  client_location: 'At your location (mobile)',
  stylist_studio: "Stylist's studio",
  salon: 'Salon',
}

export const PAYMENT_STATUS_LABELS = {
  requires_payment: 'Not paid yet',
  processing: 'Processing',
  succeeded: 'Paid',
  failed: 'Failed',
  canceled: 'Cancelled',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
  awaiting_verification: 'Awaiting verification',
}

export const PAYMENT_PROVIDER_LABELS = {
  stripe: 'Card (online)',
  manual_etransfer: 'Interac e-Transfer (manual)',
  pay_in_person: 'Pay in person',
}
