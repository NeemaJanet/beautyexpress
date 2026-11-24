import { useState } from 'react'
import { Button } from '../../components/common/Button.jsx'
import { Select } from '../../components/common/Field.jsx'
import { ImageUpload } from '../../components/common/ImageUpload.jsx'
import { ConfirmDialog } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { friendlyError } from '../../lib/validation.js'
import { getCatalogServices } from '../../services/catalogService.js'
import { deleteImage } from '../../services/storageService.js'
import { addPortfolioItem, deletePortfolioItem, listPortfolio, updatePortfolioItem } from '../../services/stylistService.js'

export default function PortfolioPage() {
  useDocumentTitle('Portfolio')
  const { user } = useAuth()
  const toast = useToast()
  const list = useAsync(() => listPortfolio(user.id), [user.id])
  const catalog = useAsync(getCatalogServices, [])
  const [deleting, setDeleting] = useState(null)
  const items = list.data || []

  const onUploaded = async ({ url, path }) => {
    const created = await addPortfolioItem({ stylist_id: user.id, image_url: url, storage_path: path, sort_order: items.length + 1 })
    list.setData((rows) => [...(rows || []), created])
  }

  const update = async (id, fields) => {
    try {
      const row = await updatePortfolioItem(id, fields)
      list.setData((rows) => rows.map((r) => (r.id === id ? row : r)))
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const move = async (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const a = items[index]
    const b = items[target]
    await Promise.all([updatePortfolioItem(a.id, { sort_order: target }), updatePortfolioItem(b.id, { sort_order: index })])
    list.reload()
  }

  const remove = async () => {
    try {
      await deletePortfolioItem(deleting.id)
      if (deleting.storage_path) await deleteImage('portfolio', deleting.storage_path).catch(() => {})
      list.setData((rows) => rows.filter((r) => r.id !== deleting.id))
      toast.success('Photo removed')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <PageHeader title="Portfolio" description="Clear, well-lit photos of your own work. The first photo is used as your cover in search."
        actions={<ImageUpload bucket="portfolio" userId={user.id} multiple label="Upload photos" variant="primary" onUploaded={onUploaded} />} />
      <p className="mb-6 text-sm text-stone">Only upload photos you took or have permission to use, and get your clients’ consent before posting their photos.</p>
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!items.length}
        empty={<EmptyState title="No photos yet">Profiles with at least three photos get far more bookings.</EmptyState>}>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p, i) => (
            <li key={p.id} className="panel overflow-hidden">
              <img src={p.image_url} alt={p.caption || 'Portfolio photo'} className="aspect-square w-full object-cover" />
              <div className="space-y-3 p-4">
                <input className="control text-sm" placeholder="Caption" defaultValue={p.caption} maxLength={300}
                  onBlur={(e) => e.target.value !== p.caption && update(p.id, { caption: e.target.value })} aria-label="Caption" />
                <Select value={p.service_id || ''} onChange={(e) => update(p.id, { service_id: e.target.value || null })} placeholder="Hairstyle (optional)"
                  options={(catalog.data || []).map((s) => ({ value: s.id, label: s.name }))} aria-label="Hairstyle" />
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">Earlier</Button>
                    <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move later">Later</Button>
                  </div>
                  <Button size="sm" variant="danger-outline" onClick={() => setDeleting(p)}>Delete</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete this photo?" confirmLabel="Delete photo" tone="danger">
        It will be removed from your public profile.
      </ConfirmDialog>
    </div>
  )
}
