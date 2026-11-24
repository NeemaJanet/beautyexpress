/**
 * Pricing helpers.
 *
 * IMPORTANT: The database function `quote_booking` is the source of truth for
 * every price a client is charged. This file mirrors the same formula so the
 * booking page can show an instant estimate while the client is choosing
 * options. A test (tests/integration/pricing-parity.test.js) checks that both
 * produce identical numbers. If you change the formula, change BOTH places.
 *
 * All amounts are integer cents: $45.50 is 4550.
 */

const roundHalfUp = (value) => Math.round(value)

/**
 * @param {object} input
 * @param {number} input.basePriceCents
 * @param {number} input.baseDurationMinutes
 * @param {{priceDeltaCents:number, durationDeltaMinutes:number}[]} [input.options]
 * @param {{baseFeeCents:number, perKmCents:number, distanceKm:number|null}|null} [input.travel]
 * @param {{percentOff?:number, amountOffCents?:number}|null} [input.promo]
 * @param {{serviceFeePercent:number, taxPercent:number, commissionPercent:number}} input.settings
 * @param {{type:'none'|'percent'|'fixed', value:number}} [input.deposit]
 */
export function calculatePrice({
  basePriceCents,
  baseDurationMinutes,
  options = [],
  travel = null,
  promo = null,
  settings,
  deposit = { type: 'none', value: 0 },
}) {
  const optionsTotal = options.reduce((sum, o) => sum + (o.priceDeltaCents || 0), 0)
  const subtotal = Math.max(basePriceCents + optionsTotal, 0)
  const duration = Math.max(
    15,
    baseDurationMinutes + options.reduce((sum, o) => sum + (o.durationDeltaMinutes || 0), 0),
  )

  let discount = 0
  if (promo?.percentOff) discount = Math.floor((subtotal * promo.percentOff) / 100)
  else if (promo?.amountOffCents) discount = Math.min(promo.amountOffCents, subtotal)

  let travelFee = 0
  let distanceKm = null
  if (travel) {
    if (travel.distanceKm == null) {
      travelFee = travel.baseFeeCents
    } else {
      distanceKm = Math.round(travel.distanceKm * 10) / 10
      travelFee = travel.baseFeeCents + roundHalfUp(travel.perKmCents * distanceKm)
    }
  }

  const serviceFee = roundHalfUp(((subtotal - discount + travelFee) * settings.serviceFeePercent) / 100)
  const tax = roundHalfUp(((subtotal - discount + travelFee + serviceFee) * settings.taxPercent) / 100)
  const total = subtotal - discount + travelFee + serviceFee + tax
  const commission = roundHalfUp(((subtotal - discount) * settings.commissionPercent) / 100)

  let depositCents = total
  if (deposit.type === 'percent') depositCents = roundHalfUp((total * deposit.value) / 100)
  else if (deposit.type === 'fixed') depositCents = Math.min(deposit.value, total)

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    travelFeeCents: travelFee,
    serviceFeeCents: serviceFee,
    taxCents: tax,
    totalCents: total,
    platformCommissionCents: commission,
    stylistEarningsCents: total - commission - serviceFee - tax,
    depositCents,
    balanceCents: total - depositCents,
    durationMinutes: duration,
    distanceKm,
  }
}

/** Format integer cents as a currency string, e.g. 4550 -> "$45.50". */
export function formatMoney(cents, currency = 'cad', locale = undefined) {
  if (cents == null || Number.isNaN(Number(cents))) return '—'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
  }).format(Number(cents) / 100)
}

/** Convert a dollars string typed in a form ("45.5") to integer cents (4550). */
export function dollarsToCents(value) {
  if (value === '' || value == null) return null
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!/[0-9]/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function centsToDollars(cents) {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

/** Human readable duration: 150 -> "2 h 30 min". */
export function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h} h ${m} min`
  if (h) return `${h} h`
  return `${m} min`
}

/** Describe a deposit rule for display. */
export function describeDeposit(type, value, currency = 'cad') {
  if (type === 'percent') return `${value}% deposit`
  if (type === 'fixed') return `${formatMoney(value, currency)} deposit`
  return 'Full payment'
}
