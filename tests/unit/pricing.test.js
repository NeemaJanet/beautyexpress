import { describe, expect, it } from 'vitest'
import { calculatePrice, centsToDollars, describeDeposit, dollarsToCents, formatDuration, formatMoney } from '../../src/lib/pricing.js'

const settings = { serviceFeePercent: 5, taxPercent: 15, commissionPercent: 15 }

describe('calculatePrice', () => {
  it('base price only', () => {
    const p = calculatePrice({ basePriceCents: 10000, baseDurationMinutes: 120, settings: { ...settings, taxPercent: 0 } })
    expect(p.subtotalCents).toBe(10000)
    expect(p.serviceFeeCents).toBe(500)
    expect(p.taxCents).toBe(0)
    expect(p.totalCents).toBe(10500)
    expect(p.platformCommissionCents).toBe(1500)
    expect(p.stylistEarningsCents).toBe(8500)
    expect(p.depositCents).toBe(10500)
    expect(p.balanceCents).toBe(0)
  })

  it('adds options to price and duration, and tax on top of the fee', () => {
    const p = calculatePrice({
      basePriceCents: 18000,
      baseDurationMinutes: 300,
      options: [
        { priceDeltaCents: 3000, durationDeltaMinutes: 60 },
        { priceDeltaCents: 1500, durationDeltaMinutes: 30 },
      ],
      settings,
    })
    expect(p.subtotalCents).toBe(22500)
    expect(p.durationMinutes).toBe(390)
    expect(p.serviceFeeCents).toBe(1125)
    expect(p.taxCents).toBe(Math.round((22500 + 1125) * 0.15)) // 3544 (3543.75 rounded)
    expect(p.totalCents).toBe(22500 + 1125 + 3544)
    // Stylist earnings never include the platform fee or tax.
    expect(p.stylistEarningsCents).toBe(22500 - 3375)
  })

  it('never lets negative options push the subtotal below zero', () => {
    const p = calculatePrice({ basePriceCents: 1000, baseDurationMinutes: 30, options: [{ priceDeltaCents: -5000, durationDeltaMinutes: -60 }], settings })
    expect(p.subtotalCents).toBe(0)
    expect(p.durationMinutes).toBe(15) // minimum duration
    expect(p.totalCents).toBe(0)
  })

  it('percent promo rounds down; fixed promo is capped at the subtotal', () => {
    const pct = calculatePrice({ basePriceCents: 9999, baseDurationMinutes: 60, promo: { percentOff: 10 }, settings })
    expect(pct.discountCents).toBe(999)
    const fixed = calculatePrice({ basePriceCents: 2000, baseDurationMinutes: 60, promo: { amountOffCents: 5000 }, settings })
    expect(fixed.discountCents).toBe(2000)
    expect(fixed.serviceFeeCents).toBe(0)
  })

  it('travel fee: base + per km, distance rounded to 0.1 km', () => {
    const p = calculatePrice({
      basePriceCents: 6000,
      baseDurationMinutes: 90,
      travel: { baseFeeCents: 1000, perKmCents: 50, distanceKm: 7.26 },
      settings: { ...settings, taxPercent: 0 },
    })
    expect(p.distanceKm).toBe(7.3)
    expect(p.travelFeeCents).toBe(1000 + Math.round(50 * 7.3))
    // Travel fee goes to the stylist; commission is only on the service price.
    expect(p.platformCommissionCents).toBe(900)
    expect(p.stylistEarningsCents).toBe(6000 + p.travelFeeCents - 900)
  })

  it('unknown distance charges only the base travel fee', () => {
    const p = calculatePrice({ basePriceCents: 6000, baseDurationMinutes: 90, travel: { baseFeeCents: 1500, perKmCents: 80, distanceKm: null }, settings })
    expect(p.travelFeeCents).toBe(1500)
    expect(p.distanceKm).toBeNull()
  })

  it('deposits: percent of the total, fixed capped at the total', () => {
    const pct = calculatePrice({ basePriceCents: 18000, baseDurationMinutes: 300, deposit: { type: 'percent', value: 25 }, settings: { ...settings, taxPercent: 0 } })
    expect(pct.totalCents).toBe(18900)
    expect(pct.depositCents).toBe(4725)
    expect(pct.balanceCents).toBe(14175)
    const fixed = calculatePrice({ basePriceCents: 1000, baseDurationMinutes: 60, deposit: { type: 'fixed', value: 5000 }, settings })
    expect(fixed.depositCents).toBe(fixed.totalCents)
  })

  it('totals always equal the sum of parts', () => {
    for (let base = 0; base < 50000; base += 3333) {
      const p = calculatePrice({ basePriceCents: base, baseDurationMinutes: 60, promo: { percentOff: 7 }, travel: { baseFeeCents: 999, perKmCents: 33, distanceKm: 12.34 }, settings: { serviceFeePercent: 4.5, taxPercent: 14.975, commissionPercent: 12.5 } })
      expect(p.totalCents).toBe(p.subtotalCents - p.discountCents + p.travelFeeCents + p.serviceFeeCents + p.taxCents)
      expect(p.stylistEarningsCents + p.platformCommissionCents + p.serviceFeeCents + p.taxCents).toBe(p.totalCents)
      expect(Number.isInteger(p.totalCents)).toBe(true)
    }
  })
})

describe('money helpers', () => {
  it('formats cents', () => {
    expect(formatMoney(4550, 'cad', 'en-CA')).toBe('$45.50')
    expect(formatMoney(null)).toBe('—')
  })
  it('converts dollars and cents safely', () => {
    expect(dollarsToCents('45.5')).toBe(4550)
    expect(dollarsToCents('0.1')).toBe(10)
    expect(dollarsToCents('19.99')).toBe(1999)
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(centsToDollars(1999)).toBe('19.99')
  })
  it('formats durations and deposits', () => {
    expect(formatDuration(150)).toBe('2 h 30 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(45)).toBe('45 min')
    expect(describeDeposit('percent', 25)).toBe('25% deposit')
    expect(describeDeposit('none', 0)).toBe('Full payment')
  })
})
