import { describe, expect, it } from 'vitest'
import { groupSlotsByPeriod, rangesOverlap, toDateKey, upcomingDays, validateWindows } from '../../src/lib/availability.js'

describe('rangesOverlap (same rule as the database double-booking constraint)', () => {
  it('detects overlaps and treats touching ranges as free', () => {
    expect(rangesOverlap('2026-11-01T10:00Z', '2026-11-01T12:00Z', '2026-11-01T11:00Z', '2026-11-01T13:00Z')).toBe(true)
    expect(rangesOverlap('2026-11-01T10:00Z', '2026-11-01T12:00Z', '2026-11-01T12:00Z', '2026-11-01T13:00Z')).toBe(false)
    expect(rangesOverlap('2026-11-01T10:00Z', '2026-11-01T12:00Z', '2026-11-01T09:00Z', '2026-11-01T10:00Z')).toBe(false)
    expect(rangesOverlap('2026-11-01T10:00Z', '2026-11-01T12:00Z', '2026-11-01T09:00Z', '2026-11-01T14:00Z')).toBe(true)
  })
})

describe('time zones', () => {
  it('builds date keys in a given time zone', () => {
    // 02:30 UTC on Nov 2 is still Nov 1 in Halifax (UTC-3 at that date).
    expect(toDateKey('2026-11-02T02:30:00Z', 'America/Halifax')).toBe('2026-11-01')
    expect(toDateKey('2026-11-02T02:30:00Z', 'UTC')).toBe('2026-11-02')
  })
  it('lists upcoming days without duplicates', () => {
    const days = upcomingDays(7, new Date('2026-11-01T12:00:00Z'), 'America/Toronto')
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-11-01')
    expect(new Set(days).size).toBe(7)
  })
  it('groups slots into morning, afternoon and evening for the viewer', () => {
    const slots = ['2026-11-03T13:00:00Z', '2026-11-03T17:30:00Z', '2026-11-03T22:00:00Z'].map((s) => ({ slot_start: s }))
    const groups = groupSlotsByPeriod(slots, 'America/Halifax') // 10:00, 14:30, 19:00 local... (UTC-4 after DST ends)
    expect(groups.map(([name, list]) => [name, list.length])).toEqual([
      ['Morning', 1],
      ['Afternoon', 1],
      ['Evening', 1],
    ])
  })
})

describe('validateWindows', () => {
  it('accepts sensible working hours with a break', () => {
    expect(validateWindows([{ start_time: '09:00', end_time: '12:30' }, { start_time: '13:00', end_time: '18:00' }])).toBeNull()
  })
  it('rejects inverted or overlapping windows', () => {
    expect(validateWindows([{ start_time: '12:00', end_time: '09:00' }])).toMatch(/after start/)
    expect(validateWindows([{ start_time: '09:00', end_time: '13:00' }, { start_time: '12:00', end_time: '18:00' }])).toMatch(/overlap/)
  })
})
