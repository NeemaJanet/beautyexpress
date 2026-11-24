import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PaymentBadge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../lib/availability.js'
import { PAYMENT_PROVIDER_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { friendlyError } from '../../lib/validation.js'
import {
  listPayments, listPayouts, listRefunds, markRefundCompleted, processBookingRefunds, releasePayouts, retryPayout, retryRefund, verifyManualPayment,
} from '../../services/adminService.js'

export default function AdminTransactionsPage() {
  useDocumentTitle('Transactions')
  const [tab, setTab] = useState('payments')
  return (
    <div>
      <PageHeader title="Transactions" description="Payments, refunds and stylist payouts. Amounts are always calculated by the server." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'payments', label: 'Payments' }, { value: 'refunds', label: 'Refunds' }, { value: 'payouts', label: 'Payouts' }]} />
      {tab === 'payments' && <Payments />}
      {tab === 'refunds' && <Refunds />}
      {tab === 'payouts' && <Payouts />}
    </div>
  )
}

function useRunner(reload) {
  const toast = useToast()
  return async (fn, msg) => {
    try {
      await fn()
      toast.success(msg)
      reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
}

function Table({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-sand bg-paper">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-sand text-left text-stone">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Payments() {
  const [status, setStatus] = useState('')
  const [provider, setProvider] = useState('')
  const list = useAsync(() => listPayments({ status, provider }), [status, provider])
  const run = useRunner(list.reload)
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="control w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['awaiting_verification', 'requires_payment', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="control w-auto" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Method">
          <option value="">All methods</option>
          {Object.entries(PAYMENT_PROVIDER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No payments" />}>
        <Table head={['Date', 'Booking', 'Method', 'Status', 'Amount', '']}>
          {list.data?.map((p) => (
            <tr key={p.id} className="border-b border-sand/60 last:border-0">
              <td className="px-4 py-3">{formatDateTime(p.created_at)}</td>
              <td className="px-4 py-3"><Link to={`/bookings/${p.booking_id}`} className="link">{p.bookings?.reference}</Link></td>
              <td className="px-4 py-3">{PAYMENT_PROVIDER_LABELS[p.provider]} ({p.kind}){p.reference_code && <span className="block text-xs text-stone">Ref {p.reference_code}</span>}{p.stripe_payment_intent_id && <span className="block text-xs text-stone">{p.stripe_payment_intent_id}</span>}</td>
              <td className="px-4 py-3"><PaymentBadge status={p.status} />{p.failure_reason && <span className="block text-xs text-danger">{p.failure_reason}</span>}</td>
              <td className="px-4 py-3 font-medium">{formatMoney(p.amount_cents, p.currency)}{p.amount_refunded_cents > 0 && <span className="block text-xs text-stone">{formatMoney(p.amount_refunded_cents, p.currency)} refunded</span>}</td>
              <td className="px-4 py-3">
                {p.provider === 'manual_etransfer' && ['awaiting_verification', 'requires_payment'].includes(p.status) && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => run(() => verifyManualPayment(p.id, true, 'Verified in bank account'), 'Payment verified')}>Verify</Button>
                    <Button size="sm" variant="ghost" onClick={() => run(() => verifyManualPayment(p.id, false, 'e-Transfer not received'), 'Marked as not received')}>Reject</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </AsyncBoundary>
      <p className="mt-3 text-xs text-stone">Verify e-Transfers only after the money has arrived in the business bank account and the message matches the reference.</p>
    </>
  )
}

function Refunds() {
  const list = useAsync(listRefunds, [])
  const run = useRunner(list.reload)
  return (
    <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No refunds" />}>
      <Table head={['Date', 'Booking', 'Reason', 'Status', 'Amount', '']}>
        {list.data?.map((r) => (
          <tr key={r.id} className="border-b border-sand/60 last:border-0">
            <td className="px-4 py-3">{formatDateTime(r.created_at)}</td>
            <td className="px-4 py-3"><Link to={`/bookings/${r.booking_id}`} className="link">{r.bookings?.reference}</Link></td>
            <td className="px-4 py-3">{r.reason}{r.failure_reason && <span className="block text-xs text-danger">{r.failure_reason}</span>}</td>
            <td className="px-4 py-3"><PaymentBadge status={r.status} /></td>
            <td className="px-4 py-3 font-medium">{formatMoney(r.amount_cents)}</td>
            <td className="px-4 py-3">
              {r.payments?.provider === 'stripe' && r.status === 'failed' && (
                <Button size="sm" variant="secondary" onClick={() => run(() => retryRefund(r.id), 'Refund retried')}>Retry</Button>
              )}
              {r.payments?.provider === 'stripe' && r.status === 'pending' && (
                <Button size="sm" variant="secondary" onClick={() => run(() => processBookingRefunds(r.booking_id), 'Refunds sent to Stripe')}>Send now</Button>
              )}
              {r.payments?.provider === 'manual_etransfer' && ['pending', 'failed'].includes(r.status) && (
                <Button size="sm" variant="secondary" onClick={() => run(() => markRefundCompleted(r.id, 'Sent by e-Transfer'), 'Refund marked as sent')}>Mark as sent</Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </AsyncBoundary>
  )
}

function Payouts() {
  const list = useAsync(listPayouts, [])
  const run = useRunner(list.reload)
  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => run(releasePayouts, 'Payout run finished')}>Release due payouts now</Button>
      </div>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No payouts yet" />}>
        <Table head={['Date', 'Booking', 'Stylist', 'Status', 'Amount', '']}>
          {list.data?.map((x) => (
            <tr key={x.id} className="border-b border-sand/60 last:border-0">
              <td className="px-4 py-3">{formatDateTime(x.created_at)}</td>
              <td className="px-4 py-3"><Link to={`/bookings/${x.booking_id}`} className="link">{x.bookings?.reference}</Link></td>
              <td className="px-4 py-3">{x.stylist_profiles?.display_name}</td>
              <td className="px-4 py-3"><PaymentBadge status={x.status} />{x.failure_reason && <span className="block text-xs text-danger">{x.failure_reason}</span>}</td>
              <td className="px-4 py-3 font-medium">{formatMoney(x.amount_cents, x.currency)}</td>
              <td className="px-4 py-3">{x.status === 'failed' && !x.stripe_transfer_id && <Button size="sm" variant="secondary" onClick={() => run(() => retryPayout(x.id), 'Payout queued for retry')}>Retry</Button>}</td>
            </tr>
          ))}
        </Table>
      </AsyncBoundary>
    </>
  )
}
