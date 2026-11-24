import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StatusBadge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../lib/availability.js'
import { PAYMENT_PROVIDER_LABELS, STATUS_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { listAllBookings } from '../../services/adminService.js'

const PAGE_SIZE = 25

export default function AdminBookingsPage() {
  useDocumentTitle('Bookings')
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const list = useAsync(() => listAllBookings({ status, search: query, page, pageSize: PAGE_SIZE }), [status, query, page])
  const pages = Math.ceil((list.data?.count || 0) / PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Bookings" description="Open a booking to cancel it, see payments or check its history." />
      <form className="mb-6 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(search.trim()) }}>
        <input className="control max-w-xs" placeholder="Booking reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Booking reference" />
        <select className="control w-auto" value={status} onChange={(e) => { setPage(0); setParams(e.target.value ? { status: e.target.value } : {}) }} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.rows.length} empty={<EmptyState title="No bookings found" />}>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-sand bg-paper">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-sand text-left text-stone">
              <tr><th className="px-4 py-3 font-normal">Reference</th><th className="px-4 py-3 font-normal">When</th><th className="px-4 py-3 font-normal">Service</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3 font-normal">Payment</th><th className="px-4 py-3 text-right font-normal">Total</th></tr>
            </thead>
            <tbody>
              {list.data?.rows.map((b) => (
                <tr key={b.id} className="border-b border-sand/60 last:border-0">
                  <td className="px-4 py-3"><Link to={`/bookings/${b.id}`} className="link">{b.reference}</Link></td>
                  <td className="px-4 py-3">{formatDateTime(b.starts_at)}</td>
                  <td className="px-4 py-3">{b.stylist_services?.title}<span className="block text-xs text-stone">{b.stylist_profiles?.display_name}</span></td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3">{PAYMENT_PROVIDER_LABELS[b.payment_provider]}<span className="block text-xs text-stone">{formatMoney(b.amount_paid_cents, b.currency)} paid</span></td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(b.total_cents, b.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page + 1} of {pages}</span>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
