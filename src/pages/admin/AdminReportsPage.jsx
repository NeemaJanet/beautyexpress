import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input, Select, TextArea } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../lib/availability.js'
import { centsToDollars, dollarsToCents, formatMoney } from '../../lib/pricing.js'
import { friendlyError } from '../../lib/validation.js'
import { listDisputes, listReports, processBookingRefunds, respondToReport, updateDispute } from '../../services/adminService.js'

export default function AdminReportsPage() {
  useDocumentTitle('Reports and disputes')
  const [tab, setTab] = useState('disputes')
  return (
    <div>
      <PageHeader title="Reports and disputes" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'disputes', label: 'Disputes' }, { value: 'reports', label: 'Support and reports' }]} />
      {tab === 'disputes' ? <Disputes /> : <Reports />}
    </div>
  )
}

function Disputes() {
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const list = useAsync(() => listDisputes(status), [status])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ status: 'under_review', notes: '', refund: '' })
  const [busy, setBusy] = useState(false)

  const openDispute = (d) => {
    setSelected(d)
    setForm({ status: d.status === 'open' ? 'under_review' : d.status, notes: d.resolution_notes || '', refund: '' })
  }

  const save = async () => {
    setBusy(true)
    try {
      const refundCents = form.status === 'resolved_refund' ? dollarsToCents(form.refund) || 0 : 0
      const r = await updateDispute(selected.id, form.status, form.notes, refundCents)
      if (r.refund_queued_cents > 0 && selected.bookings?.payment_provider === 'stripe') {
        await processBookingRefunds(selected.booking_id).catch(() => toast.info('Refund recorded; send it from Transactions if it did not go through.'))
      }
      toast.success('Dispute updated')
      setSelected(null)
      list.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const b = selected?.bookings
  const refundable = b ? b.amount_paid_cents - b.amount_refunded_cents : 0

  return (
    <>
      <select className="control mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="open">Open</option><option value="under_review">Under review</option><option value="resolved_refund">Resolved with refund</option>
        <option value="resolved_no_refund">Resolved without refund</option><option value="closed">Closed</option><option value="">All</option>
      </select>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No disputes" />}>
        <ul className="space-y-3">
          {list.data?.map((d) => (
            <li key={d.id} className="panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{d.reason}</p>
                <Badge tone={['open', 'under_review'].includes(d.status) ? 'amber' : 'gray'}>{d.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{d.description}</p>
              {d.stylist_response && <p className="mt-2 border-l-2 border-fuchsia pl-3 text-sm">Other party: {d.stylist_response}</p>}
              <p className="mt-2 text-xs text-stone">
                <Link to={`/bookings/${d.booking_id}`} className="link">Booking {d.bookings?.reference}</Link>, opened {formatDateTime(d.created_at)}
              </p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => openDispute(d)}>Review</Button>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Update dispute"
        footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save decision</Button></>}>
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-stone">
              Paid online {formatMoney(b.amount_paid_cents, b.currency)}, already refunded {formatMoney(b.amount_refunded_cents, b.currency)}.
            </p>
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={[{ value: 'under_review', label: 'Under review' }, { value: 'resolved_refund', label: 'Resolve with refund' }, { value: 'resolved_no_refund', label: 'Resolve without refund' }, { value: 'closed', label: 'Close' }]} />
            {form.status === 'resolved_refund' && (
              <Input label="Refund amount ($)" type="number" min="0" step="0.01" max={centsToDollars(refundable)} value={form.refund}
                onChange={(e) => setForm({ ...form, refund: e.target.value })} hint={`Up to ${formatMoney(refundable, b.currency)}.`} />
            )}
            <TextArea label="Decision notes (visible to both parties)" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        )}
      </Modal>
    </>
  )
}

function Reports() {
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const list = useAsync(() => listReports(status), [status])
  const [selected, setSelected] = useState(null)
  const [response, setResponse] = useState('')

  const act = async (newStatus) => {
    try {
      await respondToReport(selected.id, newStatus, response)
      toast.success('Reply sent')
      setSelected(null)
      setResponse('')
      list.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <>
      <select className="control mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="">All</option>
      </select>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="Nothing to review" />}>
        <ul className="space-y-3">
          {list.data?.map((r) => (
            <li key={r.id} className="panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.subject}</p>
                <div className="flex gap-1"><Badge tone={r.category === 'safety' || r.category === 'harassment' ? 'red' : 'gray'}>{r.category}</Badge><Badge>{r.status}</Badge></div>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{r.description}</p>
              <p className="mt-2 text-xs text-stone">
                From {r.reporter?.full_name || r.reporter?.email}, {formatDateTime(r.created_at)}
                {r.booking_id && <> · <Link to={`/bookings/${r.booking_id}`} className="link">booking</Link></>}
              </p>
              {r.admin_response && <p className="mt-2 border-l-2 border-fuchsia pl-3 text-sm">Reply: {r.admin_response}</p>}
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => { setSelected(r); setResponse(r.admin_response || '') }}>Reply</Button>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.subject || 'Reply'}
        footer={
          <>
            <Button variant="ghost" onClick={() => act('dismissed')}>Dismiss</Button>
            <Button variant="secondary" onClick={() => act('investigating')}>Reply, keep open</Button>
            <Button onClick={() => act('resolved')}>Reply and resolve</Button>
          </>
        }>
        <TextArea label="Reply to the user" rows={5} value={response} onChange={(e) => setResponse(e.target.value)} />
        <p className="mt-2 text-sm text-stone">To suspend an account, use the Users page.</p>
      </Modal>
    </>
  )
}
