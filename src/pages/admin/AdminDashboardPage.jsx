import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary } from '../../components/common/States.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { STATUS_LABELS } from '../../lib/bookingStatus.js'
import { formatMoney } from '../../lib/pricing.js'
import { getStats, releasePayouts, runNotificationJob } from '../../services/adminService.js'

export default function AdminDashboardPage() {
  useDocumentTitle('Admin')
  const toast = useToast()
  const stats = useAsync(getStats, [])
  const [busy, setBusy] = useState(null)
  const s = stats.data

  const run = async (name, fn) => {
    setBusy(name)
    try {
      const r = await fn()
      toast.success(`${name} finished${r?.processed != null ? `: ${r.processed} processed` : ''}`)
      stats.reload()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const attention = s
    ? [
        [s.open_disputes, 'open disputes', '/admin/reports'],
        [s.open_reports, 'open support requests', '/admin/reports'],
        [s.payments_awaiting_verification, 'e-Transfers to verify', '/admin/transactions'],
        [s.refunds_pending_or_failed, 'refunds pending or failed', '/admin/transactions'],
        [s.payouts_failed, 'failed payouts', '/admin/transactions'],
        [s.stylists_pending_approval, 'stylists waiting for approval', '/admin/stylists?approval=pending'],
      ].filter(([n]) => n > 0)
    : []

  return (
    <div className="space-y-10">
      <PageHeader title="Admin overview" actions={
        <>
          <Button variant="secondary" size="sm" loading={busy === 'Notification job'} onClick={() => run('Notification job', runNotificationJob)}>Run reminders and emails</Button>
          <Button variant="secondary" size="sm" loading={busy === 'Payout run'} onClick={() => run('Payout run', releasePayouts)}>Release due payouts</Button>
        </>
      } />
      <AsyncBoundary loading={stats.loading} error={stats.error} onRetry={stats.reload}>
        {s && (
          <>
            {attention.length > 0 && (
              <section className="rounded-[var(--radius-panel)] border border-warn/30 bg-warn-soft p-5">
                <h2 className="font-sans font-semibold text-warn">Needs attention</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {attention.map(([n, label, to]) => (
                    <li key={label}><Link to={to} className="text-warn underline">{n} {label}</Link></li>
                  ))}
                </ul>
              </section>
            )}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Users" value={s.users_total} sub={`${s.users_suspended} suspended`} />
              <Stat label="Stylists listed" value={s.stylists_listed} sub={`${s.stylists_total} stylist accounts`} />
              <Stat label="Bookings (30 days)" value={s.bookings_last_30_days} sub={`${s.bookings_total} all time`} />
              <Stat label="Collected online" value={formatMoney(s.gross_collected_cents)} sub={`${formatMoney(s.refunded_cents)} refunded`} />
              <Stat label="Platform revenue (completed)" value={formatMoney(s.platform_revenue_completed_cents)} sub="Commission plus booking fees" />
              <Stat label="Paid out to stylists" value={formatMoney(s.payouts_transferred_cents)} />
            </section>
            <section>
              <SectionTitle>Bookings by status</SectionTitle>
              <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(s.bookings_by_status).map(([status, n]) => (
                  <li key={status}>
                    <Link to={`/admin/bookings?status=${status}`} className="panel flex justify-between px-4 py-3 text-sm hover:border-brown">
                      <span>{STATUS_LABELS[status]}</span><span className="font-semibold">{n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="panel p-5">
      <p className="text-sm text-stone">{label}</p>
      <p className="mt-1 font-display text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone">{sub}</p>}
    </div>
  )
}
