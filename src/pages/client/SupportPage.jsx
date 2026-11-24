import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { FormError, Input, Select, TextArea } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { friendlyError } from '../../lib/validation.js'
import { listBookings } from '../../services/bookingService.js'
import { createReport, listMyDisputes, listMyReports } from '../../services/supportService.js'

const CATEGORIES = [
  { value: 'support', label: 'General question' },
  { value: 'payment', label: 'Payment or refund' },
  { value: 'quality', label: 'Service quality' },
  { value: 'safety', label: 'Safety concern' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
]
const STATUS_TONE = { open: 'amber', investigating: 'blue', resolved: 'green', dismissed: 'gray' }

export default function SupportPage() {
  useDocumentTitle('Help and support')
  const { user, isStylist } = useAuth()
  const toast = useToast()
  const reports = useAsync(() => listMyReports(user.id), [user.id])
  const disputes = useAsync(listMyDisputes, [user.id])
  const bookings = useAsync(async () => {
    const asClient = await listBookings({ as: 'client', userId: user.id, ascending: false, limit: 30 })
    const asStylist = isStylist ? await listBookings({ as: 'stylist', userId: user.id, ascending: false, limit: 30 }) : []
    return [...asClient, ...asStylist]
  }, [user.id, isStylist])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'support', subject: '', description: '', booking_id: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (form.subject.trim().length < 3 || form.description.trim().length < 10) return setError('Add a subject and describe the issue in at least a sentence.')
    setBusy(true)
    setError(null)
    try {
      await createReport({
        reporter_id: user.id,
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
        booking_id: form.booking_id || null,
      })
      toast.success('Request sent. We’ll reply here.')
      setOpen(false)
      setForm({ category: 'support', subject: '', description: '', booking_id: '' })
      reports.reload()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader title="Help and support" description="Report a problem or ask a question. Replies from our team appear below."
        actions={<Button onClick={() => setOpen(true)}>New request</Button>} />

      <section>
        <SectionTitle>Your requests</SectionTitle>
        {reports.loading ? <LoadingState /> : !reports.data?.length ? (
          <EmptyState title="No support requests">Need help with a booking, payment or your account? Start a request.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {reports.data.map((r) => (
              <li key={r.id} className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{r.subject}</p>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{r.description}</p>
                <p className="mt-1 text-xs text-stone">{formatDate(r.created_at)}</p>
                {r.admin_response && <p className="mt-3 border-l-2 border-fuchsia pl-3 text-sm">Support: {r.admin_response}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Disputes</SectionTitle>
        {!disputes.data?.length ? (
          <p className="text-stone">No disputes. To open one, go to the booking page.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper text-sm">
            {disputes.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link to={`/bookings/${d.booking_id}`} className="hover:text-brown">{d.reason} ({d.bookings?.reference})</Link>
                <Badge tone={['open', 'under_review'].includes(d.status) ? 'amber' : 'gray'}>{d.status.replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="New support request"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={busy}>Send request</Button></>}>
        <div className="space-y-4">
          <FormError error={error} />
          <Select label="Topic" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={CATEGORIES} />
          <Select label="Related booking (optional)" value={form.booking_id} onChange={(e) => setForm({ ...form, booking_id: e.target.value })} placeholder="Not about a booking"
            options={(bookings.data || []).map((b) => ({ value: b.id, label: `${b.reference}: ${b.stylist_services?.title}, ${formatDate(b.starts_at)}` }))} />
          <Input label="Subject" maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <TextArea label="Details" rows={5} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {form.category === 'safety' && <p className="text-sm text-danger">If you are in danger, contact emergency services first.</p>}
        </div>
      </Modal>
    </div>
  )
}
