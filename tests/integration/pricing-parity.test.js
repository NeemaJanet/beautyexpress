// Checks that the JavaScript price estimate (src/lib/pricing.js) and the
// authoritative database function quote_booking() always agree.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calculatePrice } from '../../src/lib/pricing.js'
import { as, createTestDatabase, hasDatabase, IDS, setSetting } from './db/helpers.js'

describe.skipIf(!hasDatabase)('Price parity: browser estimate vs server quote', () => {
  let db
  beforeAll(async () => {
    db = await createTestDatabase()
  }, 60_000)
  afterAll(async () => db?.drop())

  const cases = [
    { name: 'no options', service: IDS.cornrows, options: [], fee: 5, tax: 0, commission: 15 },
    { name: 'choose-one + add-on', service: IDS.knotless, options: [IDS.optMidBack, IDS.optCurly], fee: 5, tax: 15, commission: 15 },
    { name: 'negative add-on', service: IDS.knotless, options: [IDS.optShoulder, '0b000000-0000-4000-8000-000000000005'], fee: 3.5, tax: 13, commission: 12.5 },
    { name: 'promo + odd percentages', service: IDS.knotless, options: [IDS.optShoulder], fee: 7, tax: 14.975, commission: 20, promo: 'WELCOME10' },
    { name: 'mobile travel fee', service: IDS.cornrows, options: [], fee: 5, tax: 15, commission: 15, mobile: { lat: 45.97, lng: -66.65 } },
  ]

  for (const tc of cases) {
    it(tc.name, async () => {
      await setSetting(db.pool, 'service_fee_percent', tc.fee)
      await setSetting(db.pool, 'tax_percent', tc.tax)
      await setSetting(db.pool, 'commission_percent', tc.commission)

      const quote = await as(db.pool, 'anon', async (c) =>
        (
          await c.query(`select quote_booking($1, $2::uuid[], $3::location_type, $4, $5, $6) q`, [
            tc.service,
            tc.options,
            tc.mobile ? 'client_location' : 'stylist_studio',
            tc.mobile?.lat ?? null,
            tc.mobile?.lng ?? null,
            tc.promo ?? null,
          ])
        ).rows[0].q,
      )

      const svc = (await db.pool.query(`select * from stylist_services where id = $1`, [tc.service])).rows[0]
      const opts = (await db.pool.query(`select * from service_options where id = any($1::uuid[])`, [tc.options])).rows
      const sp = (await db.pool.query(`select * from stylist_profiles where id = $1`, [svc.stylist_id])).rows[0]
      const promo = tc.promo
        ? (await db.pool.query(`select * from promo_codes where code = $1`, [tc.promo])).rows[0]
        : null
      const distance = tc.mobile
        ? (await db.pool.query(`select distance_km($1, $2, $3, $4) d`, [sp.approx_lat, sp.approx_lng, tc.mobile.lat, tc.mobile.lng])).rows[0].d
        : null

      const js = calculatePrice({
        basePriceCents: svc.base_price_cents,
        baseDurationMinutes: svc.duration_minutes,
        options: opts.map((o) => ({ priceDeltaCents: o.price_delta_cents, durationDeltaMinutes: o.duration_delta_minutes })),
        travel: tc.mobile
          ? { baseFeeCents: sp.travel_fee_base_cents, perKmCents: sp.travel_fee_per_km_cents, distanceKm: distance }
          : null,
        promo: promo ? { percentOff: promo.percent_off, amountOffCents: promo.amount_off_cents } : null,
        settings: { serviceFeePercent: tc.fee, taxPercent: tc.tax, commissionPercent: tc.commission },
        deposit: { type: svc.deposit_type, value: svc.deposit_value },
      })

      expect(js.subtotalCents).toBe(quote.subtotal_cents)
      expect(js.discountCents).toBe(quote.discount_cents)
      expect(js.travelFeeCents).toBe(quote.travel_fee_cents)
      expect(js.serviceFeeCents).toBe(quote.service_fee_cents)
      expect(js.taxCents).toBe(quote.tax_cents)
      expect(js.totalCents).toBe(quote.total_cents)
      expect(js.platformCommissionCents).toBe(quote.platform_commission_cents)
      expect(js.stylistEarningsCents).toBe(quote.stylist_earnings_cents)
      expect(js.depositCents).toBe(quote.deposit_cents)
      expect(js.durationMinutes).toBe(quote.duration_minutes)
    })
  }

  it('line items always add up to the total', async () => {
    await setSetting(db.pool, 'tax_percent', 15)
    const q = (
      await db.pool.query(`select quote_booking($1, $2::uuid[], 'stylist_studio', null, null, 'WELCOME10') q`, [
        IDS.knotless,
        [IDS.optMidBack, IDS.optCurly],
      ])
    ).rows[0].q
    const sum = q.line_items.reduce((s, li) => s + li.amount_cents, 0)
    expect(sum).toBe(q.total_cents)
  })
})
