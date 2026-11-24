import { useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { brand } from '../../config/brand.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate, formatDateTime } from '../../lib/availability.js'
import { PAYMENT_PROVIDER_LABELS, PAYMENT_STATUS_LABELS, STATUS_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { getBooking } from '../../services/bookingService.js'

/** Printable receipt. Use the browser's "Save as PDF" to download. */
export default function ReceiptPage() {
  const { id } = useParams()
  const { data: b, loading } = useAsync(() => getBooking(id), [id])
  useDocumentTitle('Receipt')
  if (loading) return <LoadingState className="min-h-screen" />
  if (!b) return <div className="p-10"><EmptyState title="Receipt not found" /></div>

  const refunded = b.refunds.filter((r) => r.status === 'succeeded').reduce((s, r) => s + r.amount_cents, 0)
  const paid = b.payments.filter((p) => ['succeeded', 'partially_refunded', 'refunded'].includes(p.status))

  return (
    <div className="mx-auto max-w-2xl bg-paper px-8 py-10 print:px-0">
      <div className="no-print mb-6 flex justify-between">
        <Button variant="ghost" to={`/bookings/${b.id}`}>Back to booking</Button>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
      </div>
      <header className="flex items-start justify-between border-b border-sand pb-6">
        <div>
          <p className="font-display text-2xl">{brand.name}</p>
          <p className="text-sm text-stone">{brand.legalName}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">Receipt</p>
          <p>Booking {b.reference}</p>
          <p className="text-stone">Issued {formatDate(new Date())}</p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-6 py-6 text-sm">
        <div>
          <p className="text-stone">Client</p>
          <p>{b.client?.full_name}</p>
        </div>
        <div>
          <p className="text-stone">Stylist</p>
          <p>{b.stylist_profiles?.display_name}</p>
          {b.stylist_profiles?.business_name && <p>{b.stylist_profiles.business_name}</p>}
        </div>
        <div>
          <p className="text-stone">Appointment</p>
          <p>{formatDateTime(b.starts_at)}</p>
        </div>
        <div>
          <p className="text-stone">Status</p>
          <p>{STATUS_LABELS[b.status]}</p>
        </div>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sand text-left text-stone">
            <th className="py-2 font-normal">Item</th>
            <th className="py-2 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {b.line_items.map((li) => (
            <tr key={li.id} className="border-b border-sand/60">
              <td className="py-2">{li.description}</td>
              <td className="py-2 text-right">{formatMoney(li.amount_cents, b.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 font-semibold">Total</td>
            <td className="pt-3 text-right font-semibold">{formatMoney(b.total_cents, b.currency)}</td>
          </tr>
        </tfoot>
      </table>
      <section className="mt-8 text-sm">
        <p className="mb-2 font-semibold">Payments</p>
        {paid.length === 0 && <p className="text-stone">No payments recorded through {brand.name}.</p>}
        {paid.map((p) => (
          <p key={p.id} className="flex justify-between">
            <span>{formatDate(p.created_at)}, {PAYMENT_PROVIDER_LABELS[p.provider]} ({PAYMENT_STATUS_LABELS[p.status]})</span>
            <span>{formatMoney(p.amount_cents, p.currency)}</span>
          </p>
        ))}
        {refunded > 0 && (
          <p className="mt-1 flex justify-between text-success">
            <span>Refunded</span>
            <span>−{formatMoney(refunded, b.currency)}</span>
          </p>
        )}
      </section>
      <p className="mt-10 text-xs text-stone">
        Tax registration numbers and tax breakdown should be added here once your tax setup is confirmed with an accountant.
      </p>
    </div>
  )
}
