import { describe, expect, it } from 'vitest'
import { availableActions, canTransition, STATUS_LABELS, STYLIST_TRANSITIONS } from '../../src/lib/bookingStatus.js'

const at = (offsetMinutes) => new Date(Date.UTC(2026, 10, 1, 15, 0) + offsetMinutes * 60000).toISOString()
const NOW = new Date(Date.UTC(2026, 10, 1, 15, 0))

describe('status transitions (mirror of transition_booking in the database)', () => {
  it('allows only the documented forward moves', () => {
    expect(canTransition('requested', 'confirmed')).toBe(true)
    expect(canTransition('requested', 'declined')).toBe(true)
    expect(canTransition('confirmed', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'completed')).toBe(true)
    expect(canTransition('requested', 'completed')).toBe(false)
    expect(canTransition('completed', 'confirmed')).toBe(false)
    expect(canTransition('cancelled_by_client', 'confirmed')).toBe(false)
    expect(canTransition('pending_payment', 'confirmed')).toBe(false) // only the payment webhook does this
  })

  it('every status has a label', () => {
    for (const s of Object.keys(STYLIST_TRANSITIONS).concat(...Object.values(STYLIST_TRANSITIONS))) {
      expect(STATUS_LABELS[s]).toBeTruthy()
    }
  })
})

describe('availableActions', () => {
  it('stylist sees accept/decline for requests; client sees cancel and reschedule', () => {
    const b = { status: 'requested', starts_at: at(24 * 60) }
    expect(availableActions(b, 'stylist', NOW)).toEqual(expect.arrayContaining(['accept', 'decline', 'cancel', 'reschedule']))
    expect(availableActions(b, 'client', NOW)).toEqual(['cancel', 'reschedule'])
  })

  it('start is offered only from one hour before; no-show 15 minutes after', () => {
    const b = { status: 'confirmed', starts_at: at(90) }
    expect(availableActions(b, 'stylist', NOW)).not.toContain('start')
    expect(availableActions({ ...b, starts_at: at(30) }, 'stylist', NOW)).toContain('start')
    expect(availableActions({ ...b, starts_at: at(-10) }, 'stylist', NOW)).not.toContain('no_show')
    expect(availableActions({ ...b, starts_at: at(-20) }, 'stylist', NOW)).toContain('no_show')
  })

  it('completed and cancelled bookings offer no status actions', () => {
    expect(availableActions({ status: 'completed', starts_at: at(-600) }, 'stylist', NOW)).toEqual([])
    expect(availableActions({ status: 'cancelled_by_client', starts_at: at(600) }, 'client', NOW)).toEqual([])
  })

  it('a client with a pending payment is offered to pay', () => {
    expect(availableActions({ status: 'pending_payment', starts_at: at(600) }, 'client', NOW)).toContain('pay')
  })
})
