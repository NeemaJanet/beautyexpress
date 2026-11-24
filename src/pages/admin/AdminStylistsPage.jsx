import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { friendlyError } from '../../lib/validation.js'
import { listStylists, updateStylist } from '../../services/adminService.js'

const APPROVAL_TONE = { pending: 'amber', approved: 'green', rejected: 'red' }
const VERIFY_TONE = { unverified: 'gray', pending: 'amber', verified: 'green', rejected: 'red' }

export default function AdminStylistsPage() {
  useDocumentTitle('Stylists')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const approval = params.get('approval') || ''
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const list = useAsync(() => listStylists({ approval, search: query }), [approval, query])

  const update = async (id, changes, msg) => {
    try {
      await updateStylist(id, changes)
      toast.success(msg)
      list.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div>
      <PageHeader title="Stylists" description="Approve new profiles, verify credentials and choose featured stylists." />
      <form className="mb-6 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()) }}>
        <input className="control max-w-xs" placeholder="Search name or city" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stylists" />
        <select className="control w-auto" value={approval} onChange={(e) => setParams(e.target.value ? { approval: e.target.value } : {})} aria-label="Approval status">
          <option value="">All</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <p className="mb-4 text-sm text-stone">Approval only hides profiles from search when “Require stylist approval” is on in Platform settings. Verification adds a badge after you have checked licences or identity outside the app.</p>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No stylists found" />}>
        <ul className="space-y-3">
          {list.data?.map((s) => (
            <li key={s.id} className="panel p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Link to={`/stylists/${s.id}`} className="font-medium hover:text-brown">{s.display_name || '(no name yet)'}</Link>
                  <p className="text-sm text-stone">{s.business_name} {s.city && `· ${s.city}, ${s.province}`} · {s.profiles?.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge tone={APPROVAL_TONE[s.approval_status]}>{s.approval_status}</Badge>
                    <Badge tone={VERIFY_TONE[s.verification_status]}>{s.verification_status}</Badge>
                    {s.is_featured && <Badge tone="ink">featured</Badge>}
                    {!s.onboarding_completed && <Badge>not published</Badge>}
                    {s.profiles?.status === 'suspended' && <Badge tone="red">suspended</Badge>}
                  </div>
                </div>
                <RatingStars value={s.rating_avg} count={s.rating_count} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {s.approval_status !== 'approved' && <Button size="sm" onClick={() => update(s.id, { approval: 'approved' }, 'Stylist approved')}>Approve</Button>}
                {s.approval_status !== 'rejected' && <Button size="sm" variant="danger-outline" onClick={() => update(s.id, { approval: 'rejected' }, 'Stylist rejected')}>Reject</Button>}
                {s.verification_status !== 'verified' ? (
                  <Button size="sm" variant="secondary" onClick={() => update(s.id, { verification: 'verified' }, 'Marked as verified')}>Mark verified</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => update(s.id, { verification: 'unverified' }, 'Verification removed')}>Remove verification</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => update(s.id, { featured: !s.is_featured }, s.is_featured ? 'No longer featured' : 'Featured')}>
                  {s.is_featured ? 'Unfeature' : 'Feature'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
    </div>
  )
}
