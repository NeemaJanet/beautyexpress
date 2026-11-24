import { Link } from 'react-router-dom'
import { PaymentBadge } from '../../components/common/Badge.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { PAYMENT_PROVIDER_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { listMyPayments, listMyRefunds } from '../../services/paymentService.js'

export default function PaymentsPage() {
  useDocumentTitle('Payments')
  const { user } = useAuth()
  const payments = useAsync(() => listMyPayments(user.id), [user.id])
  const refunds = useAsync(listMyRefunds, [user.id])

  return (
    <div className="space-y-10">
      <PageHeader title="Payments and receipts" description="Card details are stored by Stripe, never by BeautyExpress." />
      <AsyncBoundary loading={payments.loading} error={payments.error} onRetry={payments.reload} isEmpty={!payments.data?.length}
        empty={<EmptyState title="No payments yet" />}>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-sand bg-paper">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-sand text-left text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 font-normal">Booking</th>
                <th className="px-4 py-3 font-normal">Method</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 font-normal"><span className="sr-only">Receipt</span></th>
              </tr>
            </thead>
            <tbody>
              {payments.data?.map((p) => (
                <tr key={p.id} className="border-b border-sand/60 last:border-0">
                  <td className="px-4 py-3">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/bookings/${p.booking_id}`} className="hover:text-brown">
                      {p.bookings?.stylist_services?.title} ({p.bookings?.reference})
                    </Link>
                  </td>
                  <td className="px-4 py-3">{PAYMENT_PROVIDER_LABELS[p.provider]}</td>
                  <td className="px-4 py-3"><PaymentBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(p.amount_cents, p.currency)}</td>
                  <td className="px-4 py-3"><Link to={`/bookings/${p.booking_id}/receipt`} className="link">Receipt</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBoundary>

      {refunds.data?.length > 0 && (
        <section>
          <SectionTitle>Refunds</SectionTitle>
          <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper text-sm">
            {refunds.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>{formatDate(r.created_at)}, {r.bookings?.stylist_services?.title} ({r.bookings?.reference})</span>
                <PaymentBadge status={r.status} />
                <span className="font-medium">{formatMoney(r.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
