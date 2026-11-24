import { useState } from 'react'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { AddressForm } from '../../components/forms/AddressForm.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { supabase, unwrap } from '../../lib/supabase.js'

export default function AddressesPage() {
  useDocumentTitle('Saved addresses')
  const { user } = useAuth()
  const toast = useToast()
  const list = useAsync(async () => unwrap(await supabase.from('addresses').select('*').eq('user_id', user.id).order('created_at')), [user.id])
  const [editing, setEditing] = useState(null) // address object or {} for new
  const [deleting, setDeleting] = useState(null)

  const save = async (row) => {
    if (editing.id) unwrap(await supabase.from('addresses').update(row).eq('id', editing.id))
    else unwrap(await supabase.from('addresses').insert({ ...row, user_id: user.id }))
    toast.success('Address saved')
    setEditing(null)
    list.reload()
  }

  const remove = async () => {
    try {
      unwrap(await supabase.from('addresses').delete().eq('id', deleting.id))
      toast.success('Address deleted')
      list.reload()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <PageHeader title="Saved addresses" description="Used for mobile appointments. Stylists see an address only after confirming your booking."
        actions={<Button onClick={() => setEditing({})}>Add address</Button>} />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length}
        empty={<EmptyState title="No saved addresses" action={<Button onClick={() => setEditing({})}>Add your first address</Button>}>Add your home or another place where a stylist can come to you.</EmptyState>}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.data?.map((a) => (
            <li key={a.id} className="panel p-5">
              <div className="flex items-center gap-2">
                <p className="font-medium">{a.label}</p>
                {a.is_default && <Badge tone="brown">Default</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-soft">{[a.line1, a.line2, a.city, a.province, a.postal_code].filter(Boolean).join(', ')}</p>
              {a.lat == null && <p className="mt-1 text-xs text-warn">Location not found; travel fees will be confirmed by the stylist.</p>}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit address' : 'Add an address'}>
        {editing && <AddressForm initial={editing.id ? editing : undefined} onSave={save} onCancel={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete this address?" confirmLabel="Delete address" tone="danger">
        Past bookings keep their own copy of the address.
      </ConfirmDialog>
    </div>
  )
}
