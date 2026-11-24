import { useState } from 'react'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, FormError, Input, TextArea } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { friendlyError } from '../../lib/validation.js'
import { listAllCategories, saveCatalogService, saveCategory } from '../../services/adminService.js'

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export default function AdminCategoriesPage() {
  useDocumentTitle('Categories')
  const toast = useToast()
  const list = useAsync(listAllCategories, [])
  const [editing, setEditing] = useState(null) // { kind: 'category'|'service', row }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const r = editing.row
    if (!r.name?.trim()) return setError('Name is required.')
    setBusy(true)
    setError(null)
    try {
      const row = { ...r, name: r.name.trim(), slug: r.slug?.trim() || slugify(r.name) }
      delete row.services
      if (editing.kind === 'category') await saveCategory(row)
      else await saveCatalogService({ ...row, typical_duration_minutes: Number(row.typical_duration_minutes) || 60 })
      toast.success('Saved')
      setEditing(null)
      list.reload()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const set = (k) => (e) => setEditing({ ...editing, row: { ...editing.row, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } })

  return (
    <div>
      <PageHeader title="Categories and hairstyles" description="The shared catalogue stylists choose from when listing services."
        actions={<Button onClick={() => setEditing({ kind: 'category', row: { name: '', slug: '', description: '', image_url: '', sort_order: (list.data?.length || 0) + 1, is_active: true } })}>Add category</Button>} />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length} empty={<EmptyState title="No categories" />}>
        <div className="space-y-4">
          {list.data?.map((c) => (
            <section key={c.id} className="panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-sans text-lg font-semibold">{c.name}</h2>
                  {!c.is_active && <Badge>hidden</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'category', row: c })}>Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'service', row: { category_id: c.id, name: '', slug: '', description: '', typical_duration_minutes: 120, is_active: true } })}>Add hairstyle</Button>
                </div>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {c.services?.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setEditing({ kind: 'service', row: s })} className={`rounded-full border px-3 py-1 text-sm hover:border-brown ${s.is_active ? 'border-sand' : 'border-dashed border-sand text-stone'}`}>
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </AsyncBoundary>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `${editing.row.id ? 'Edit' : 'Add'} ${editing.kind === 'category' ? 'category' : 'hairstyle'}` : ''}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <FormError error={error} />
            <Input label="Name" value={editing.row.name} onChange={set('name')} />
            <Input label="URL name (slug)" value={editing.row.slug} onChange={set('slug')} placeholder={slugify(editing.row.name || '')} hint="Lowercase letters, numbers and dashes. Changing it breaks old links." />
            <TextArea label="Description" rows={3} value={editing.row.description || ''} onChange={set('description')} />
            <Input label="Image URL" value={editing.row.image_url || ''} onChange={set('image_url')} hint="Use an image you own the rights to." />
            {editing.kind === 'category' ? (
              <Input label="Order" type="number" value={editing.row.sort_order} onChange={set('sort_order')} />
            ) : (
              <Input label="Typical duration (minutes)" type="number" min="15" max="720" value={editing.row.typical_duration_minutes} onChange={set('typical_duration_minutes')} />
            )}
            <Checkbox label="Visible" checked={editing.row.is_active} onChange={set('is_active')} />
          </div>
        )}
      </Modal>
    </div>
  )
}
