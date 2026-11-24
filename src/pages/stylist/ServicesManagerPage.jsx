import { useState } from 'react'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { ConfirmDialog, Modal } from '../../components/common/Modal.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { OptionsEditor } from '../../components/services/OptionsEditor.jsx'
import { ServiceEditor } from '../../components/services/ServiceEditor.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { LOCATION_LABELS } from '../../lib/bookingStatus.js'
import { describeDeposit, formatDuration, formatMoney } from '../../lib/pricing.js'
import { getCatalogServices, getPublicSettings } from '../../services/catalogService.js'
import { deleteService, listMyServices, saveService } from '../../services/stylistService.js'

export default function ServicesManagerPage() {
  useDocumentTitle('Services and prices')
  const { user, stylistProfile } = useAuth()
  const toast = useToast()
  const services = useAsync(() => listMyServices(user.id), [user.id])
  const catalog = useAsync(getCatalogServices, [])
  const settings = useAsync(getPublicSettings, [])
  const [editing, setEditing] = useState(null) // null | {} | service
  const [optionsFor, setOptionsFor] = useState(null) // service id
  const [deleting, setDeleting] = useState(null)

  const save = async (row) => {
    await saveService(user.id, row)
    toast.success('Service saved')
    setEditing(null)
    services.reload()
  }

  const remove = async () => {
    try {
      await deleteService(deleting.id)
      toast.success('Service deleted')
      services.reload()
    } catch (e) {
      // Services with bookings cannot be deleted (history must be kept).
      if (/foreign key|violates/i.test(e.message)) {
        await saveService(user.id, { id: deleting.id, is_active: false })
        toast.info('This service has bookings, so it was hidden instead of deleted.')
        services.reload()
      } else toast.error(e.message)
    } finally {
      setDeleting(null)
    }
  }

  const optionsService = services.data?.find((s) => s.id === optionsFor)

  return (
    <div>
      <PageHeader title="Services and prices" description="What clients can book, with your prices, time needed and options."
        actions={<Button onClick={() => setEditing({})}>Add service</Button>} />
      <AsyncBoundary loading={services.loading} error={services.error} onRetry={services.reload} isEmpty={!services.data?.length}
        empty={<EmptyState title="No services yet" action={<Button onClick={() => setEditing({})}>Add your first service</Button>} />}>
        <ul className="space-y-4">
          {services.data?.map((s) => (
            <li key={s.id} className="panel p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-sans text-lg font-semibold">{s.title}</h2>
                    {!s.is_active && <Badge>Hidden</Badge>}
                    {s.booking_mode && <Badge tone="blue">{s.booking_mode === 'instant' ? 'Instant' : 'Approval'}</Badge>}
                  </div>
                  <p className="text-sm text-stone">{s.services?.name}, {formatDuration(s.duration_minutes)}, {describeDeposit(s.deposit_type, s.deposit_value)}</p>
                  <p className="mt-1 text-sm text-stone">{s.location_types.map((l) => LOCATION_LABELS[l]).join(', ')}</p>
                  {s.service_options?.length > 0 && <p className="mt-1 text-sm text-stone">{s.service_options.length} options</p>}
                </div>
                <p className="font-display text-2xl">{formatMoney(s.base_price_cents)}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Edit</Button>
                <Button size="sm" variant="secondary" onClick={() => setOptionsFor(s.id)}>Options</Button>
                <Button size="sm" variant="ghost" onClick={() => saveService(user.id, { id: s.id, is_active: !s.is_active }).then(services.reload)}>
                  {s.is_active ? 'Hide' : 'Show'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      </AsyncBoundary>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit service' : 'Add a service'} size="lg">
        {editing && catalog.data && (
          <ServiceEditor initial={editing.id ? editing : null} catalog={catalog.data} stylist={stylistProfile} settings={settings.data} onSave={save} onCancel={() => setEditing(null)} />
        )}
      </Modal>
      <Modal open={Boolean(optionsService)} onClose={() => setOptionsFor(null)} title={`Options for ${optionsService?.title || ''}`} size="lg">
        {optionsService && <OptionsEditor service={optionsService} onChanged={services.reload} />}
      </Modal>
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete this service?" confirmLabel="Delete" tone="danger">
        Clients will no longer be able to book it. Existing bookings are not affected.
      </ConfirmDialog>
    </div>
  )
}
