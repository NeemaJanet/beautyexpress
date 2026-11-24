import { formatMoney } from '../../lib/pricing.js'

/**
 * Itemised price. `items` are line items from quote_booking() or
 * booking_line_items. Totals are shown exactly as the server calculated.
 */
export function PriceBreakdown({ items = [], total, currency = 'cad', deposit, balance, estimate = false }) {
  return (
    <div>
      <dl className="space-y-2 text-sm">
        {items.map((li, i) => (
          <div key={li.id || `${li.kind}-${i}`} className="flex justify-between gap-4">
            <dt className={li.kind === 'option' ? 'pl-3 text-stone' : 'text-ink-soft'}>{li.description}</dt>
            <dd className={li.amount_cents < 0 ? 'text-success' : ''}>{formatMoney(li.amount_cents, currency)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-baseline justify-between border-t border-sand pt-3">
        <span className="font-medium">{estimate ? 'Estimated total' : 'Total'}</span>
        <span className="font-display text-2xl">{formatMoney(total, currency)}</span>
      </div>
      {deposit != null && balance > 0 && (
        <p className="mt-2 text-sm text-stone">
          {formatMoney(deposit, currency)} due when you book, {formatMoney(balance, currency)} later.
        </p>
      )}
    </div>
  )
}
