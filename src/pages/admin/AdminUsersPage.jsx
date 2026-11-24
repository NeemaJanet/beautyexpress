import { useState } from 'react'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { TextArea } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { friendlyError } from '../../lib/validation.js'
import { listUsers, setUserRole, setUserStatus } from '../../services/adminService.js'

const PAGE_SIZE = 25

export default function AdminUsersPage() {
  useDocumentTitle('Users')
  const { user: me } = useAuth()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const list = useAsync(() => listUsers({ search: query, status, page, pageSize: PAGE_SIZE }), [query, status, page])
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')

  const act = async (fn, msg) => {
    try {
      await fn()
      toast.success(msg)
      setSelected(null)
      setReason('')
      list.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const roles = (u) => u.user_roles?.map((r) => r.role) || []
  const pages = Math.ceil((list.data?.count || 0) / PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Users" />
      <form className="mb-6 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(search.trim()) }}>
        <input className="control max-w-xs" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <select className="control w-auto" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value) }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.rows.length} empty={<EmptyState title="No users found" />}>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-sand bg-paper">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-sand text-left text-stone">
              <tr><th className="px-4 py-3 font-normal">Name</th><th className="px-4 py-3 font-normal">Email</th><th className="px-4 py-3 font-normal">Roles</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3 font-normal">Joined</th><th /></tr>
            </thead>
            <tbody>
              {list.data?.rows.map((u) => (
                <tr key={u.id} className="border-b border-sand/60 last:border-0">
                  <td className="px-4 py-3">{u.full_name || '—'}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{roles(u).map((r) => <Badge key={r} tone={r === 'admin' ? 'ink' : r === 'stylist' ? 'fuchsia' : 'gray'}>{r}</Badge>)}</div></td>
                  <td className="px-4 py-3"><Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status}</Badge></td>
                  <td className="px-4 py-3">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="secondary" onClick={() => setSelected(u)}>Manage</Button></td>
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

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.full_name || selected?.email || 'User'}>
        {selected && (
          <div className="space-y-6">
            <p className="text-sm text-stone">{selected.email}{selected.phone ? `, ${selected.phone}` : ''}</p>
            {selected.status_reason && <p className="text-sm">Suspension reason: {selected.status_reason}</p>}
            <div className="space-y-3">
              <h3 className="font-sans font-semibold">Account status</h3>
              {selected.id === me.id ? (
                <p className="text-sm text-stone">You can’t change your own status.</p>
              ) : selected.status === 'active' ? (
                <>
                  <TextArea label="Reason (shown to the user)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="danger" onClick={() => act(() => setUserStatus(selected.id, 'suspended', reason), 'User suspended')}>Suspend account</Button>
                </>
              ) : (
                <Button onClick={() => act(() => setUserStatus(selected.id, 'active'), 'User reactivated')}>Reactivate account</Button>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="font-sans font-semibold">Roles</h3>
              {['stylist', 'admin'].map((r) => {
                const has = roles(selected).includes(r)
                return (
                  <div key={r} className="flex items-center justify-between rounded-[var(--radius-control)] bg-sand-soft px-4 py-2 text-sm">
                    <span className="capitalize">{r}</span>
                    <Button size="sm" variant={has ? 'danger-outline' : 'secondary'} disabled={r === 'admin' && has && selected.id === me.id}
                      onClick={() => act(() => setUserRole(selected.id, r, !has), has ? `Removed ${r} role` : `Granted ${r} role`)}>
                      {has ? 'Remove' : 'Grant'}
                    </Button>
                  </div>
                )
              })}
              <p className="text-xs text-stone">Granting admin gives full access to every account and payment. Every change is recorded in the audit log.</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
