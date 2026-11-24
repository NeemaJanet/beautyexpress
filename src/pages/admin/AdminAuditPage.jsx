import { useState } from 'react'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../lib/availability.js'
import { listAuditLogs } from '../../services/adminService.js'

const PAGE_SIZE = 50
const TABLES = ['', 'platform_settings', 'user_roles', 'profiles', 'stylist_profiles', 'payments', 'refunds', 'payouts', 'disputes', 'reports', 'service_categories', 'services', 'promo_codes']

/** Changes made to the audit log are impossible from the app: it is insert-only via the database. */
export default function AdminAuditPage() {
  useDocumentTitle('Audit log')
  const [page, setPage] = useState(0)
  const [table, setTable] = useState('')
  const [open, setOpen] = useState(null)
  const list = useAsync(() => listAuditLogs({ page, pageSize: PAGE_SIZE, table }), [page, table])
  const pages = Math.ceil((list.data?.count || 0) / PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Audit log" description="Every administrative change and every change to settings, roles, refunds and payouts." />
      <select className="control mb-4 w-auto" value={table} onChange={(e) => { setPage(0); setTable(e.target.value) }} aria-label="Filter by area">
        {TABLES.map((t) => <option key={t} value={t}>{t ? t.replace(/_/g, ' ') : 'Everything'}</option>)}
      </select>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.rows.length} empty={<EmptyState title="No entries" />}>
        <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper text-sm">
          {list.data?.rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span><span className="font-medium">{r.action}</span> on {r.table_name}{r.record_id && <span className="text-stone"> ({r.record_id.slice(0, 8)})</span>}</span>
                <span className="text-stone">{r.actor?.full_name || r.actor?.email || 'System'}, {formatDateTime(r.created_at)}</span>
              </button>
              {open === r.id && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {['old_data', 'new_data'].map((k) => (
                    <div key={k}>
                      <p className="mb-1 text-xs text-stone">{k === 'old_data' ? 'Before' : 'After'}</p>
                      <pre className="max-h-64 overflow-auto rounded bg-sand-soft p-3 text-xs">{r[k] ? JSON.stringify(r[k], null, 2) : '—'}</pre>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
            <span>Page {page + 1} of {pages}</span>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Older</Button>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
