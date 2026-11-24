import { useState } from 'react'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, FormError, Input } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary } from '../../components/common/States.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { centsToDollars, dollarsToCents } from '../../lib/pricing.js'
import { isStripeConfigured } from '../../lib/stripe.js'
import { friendlyError } from '../../lib/validation.js'
import { listPromoCodes, listSettings, savePromoCode, updateSetting } from '../../services/adminService.js'

const GROUPS = [
  ['Fees and money', ['currency', 'commission_percent', 'service_fee_percent', 'tax_percent']],
  ['Payment methods', ['online_payments_enabled', 'manual_etransfer_enabled', 'etransfer_recipient_email', 'pay_in_person_enabled', 'stripe_connect_country']],
  ['Policies', ['free_cancellation_hours', 'late_cancellation_fee_percent', 'payment_hold_minutes', 'payout_hold_hours', 'review_window_days', 'require_stylist_approval']],
  ['Limits and contact', ['max_bookings_per_hour', 'max_messages_per_minute', 'support_email']],
]

export default function AdminSettingsPage() {
  useDocumentTitle('Platform settings')
  const settings = useAsync(listSettings, [])
  const promos = useAsync(listPromoCodes, [])
  const byKey = Object.fromEntries((settings.data || []).map((s) => [s.key, s]))

  return (
    <div className="space-y-8">
      <PageHeader title="Platform settings" description="Every change takes effect immediately for new bookings and is written to the audit log." />
      <AsyncBoundary loading={settings.loading} error={settings.error} onRetry={settings.reload}>
        {GROUPS.map(([title, keys]) => (
          <section key={title} className="panel p-6">
            <SectionTitle>{title}</SectionTitle>
            <div className="divide-y divide-sand">
              {keys.filter((k) => byKey[k]).map((k) => <SettingRow key={k} setting={byKey[k]} onSaved={settings.reload} />)}
            </div>
          </section>
        ))}
      </AsyncBoundary>
      <PromoCodes list={promos} />
    </div>
  )
}

function SettingRow({ setting, onSaved }) {
  const toast = useToast()
  const isBool = typeof setting.value === 'boolean'
  const isNum = typeof setting.value === 'number'
  const [value, setValue] = useState(isBool ? setting.value : String(setting.value ?? ''))
  const [busy, setBusy] = useState(false)
  const dirty = isBool ? value !== setting.value : value !== String(setting.value ?? '')

  const save = async (next = value) => {
    if (setting.key === 'online_payments_enabled' && next === true && !isStripeConfigured) {
      toast.error('Add VITE_STRIPE_PUBLISHABLE_KEY and deploy the Stripe functions before turning on card payments.')
      setValue(false)
      return
    }
    setBusy(true)
    try {
      await updateSetting(setting.key, isBool ? next : isNum ? Number(next) : String(next).trim())
      toast.success('Setting saved')
      onSaved()
    } catch (e) {
      toast.error(friendlyError(e))
      setValue(isBool ? setting.value : String(setting.value))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[1fr_260px] sm:items-center">
      <div>
        <p className="font-medium">{setting.key.replace(/_/g, ' ')}</p>
        <p className="text-sm text-stone">{setting.description}</p>
        {!setting.is_public && <Badge className="mt-1">private</Badge>}
      </div>
      {isBool ? (
        <Checkbox label={value ? 'On' : 'Off'} checked={value} disabled={busy} onChange={(e) => { setValue(e.target.checked); save(e.target.checked) }} />
      ) : (
        <div className="flex gap-2">
          <input className="control" type={isNum ? 'number' : 'text'} step="any" value={value} onChange={(e) => setValue(e.target.value)} aria-label={setting.key} />
          <Button size="sm" variant="secondary" disabled={!dirty} loading={busy} onClick={() => save()}>Save</Button>
        </div>
      )}
    </div>
  )
}

function PromoCodes({ list }) {
  const toast = useToast()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)

  const save = async () => {
    const r = editing
    if (!r.code?.trim()) return setError('Enter a code.')
    if (r.type === 'percent' && !(Number(r.percent_off) >= 1 && Number(r.percent_off) <= 100)) return setError('Percent must be 1–100.')
    if (r.type === 'amount' && !(dollarsToCents(r.amount_off) > 0)) return setError('Enter an amount.')
    try {
      await savePromoCode({
        id: r.id,
        code: r.code.trim().toUpperCase(),
        description: r.description || '',
        percent_off: r.type === 'percent' ? Number(r.percent_off) : null,
        amount_off_cents: r.type === 'amount' ? dollarsToCents(r.amount_off) : null,
        max_redemptions: r.max_redemptions ? Number(r.max_redemptions) : null,
        min_subtotal_cents: dollarsToCents(r.min_subtotal) || 0,
        expires_at: r.expires_at ? new Date(`${r.expires_at}T23:59`).toISOString() : null,
        is_active: r.is_active,
      })
      toast.success('Promo code saved')
      setEditing(null)
      list.reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const edit = (p) => {
    setError(null)
    setEditing(p ? {
      ...p,
      type: p.percent_off ? 'percent' : 'amount',
      amount_off: centsToDollars(p.amount_off_cents),
      min_subtotal: centsToDollars(p.min_subtotal_cents),
      expires_at: p.expires_at?.slice(0, 10) || '',
    } : { code: '', description: '', type: 'percent', percent_off: '10', amount_off: '', max_redemptions: '', min_subtotal: '', expires_at: '', is_active: true })
  }
  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  return (
    <section className="panel p-6">
      <SectionTitle action={<Button size="sm" onClick={() => edit(null)}>Add promo code</Button>}>Promo codes</SectionTitle>
      <p className="mb-4 text-sm text-stone">Discounts reduce the service price. Commission is calculated on the discounted price, so stylists and the platform share the cost.</p>
      {!list.data?.length ? <p className="text-stone">No promo codes.</p> : (
        <ul className="divide-y divide-sand text-sm">
          {list.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="font-medium">{p.code}</span>
              <span>{p.percent_off ? `${p.percent_off}% off` : `$${centsToDollars(p.amount_off_cents)} off`}</span>
              <span className="text-stone">{p.redemptions}{p.max_redemptions ? ` / ${p.max_redemptions}` : ''} used{p.expires_at ? `, until ${formatDate(p.expires_at)}` : ''}</span>
              <Badge tone={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'active' : 'off'}</Badge>
              <Button size="sm" variant="ghost" onClick={() => edit(p)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit promo code' : 'Add promo code'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <FormError error={error} />
            <Input label="Code" value={editing.code} onChange={set('code')} />
            <Input label="Description" value={editing.description} onChange={set('description')} />
            <select className="control" value={editing.type} onChange={set('type')} aria-label="Discount type">
              <option value="percent">Percent off</option><option value="amount">Fixed amount off</option>
            </select>
            {editing.type === 'percent' ? <Input label="Percent off" type="number" value={editing.percent_off} onChange={set('percent_off')} /> : <Input label="Amount off ($)" type="number" step="0.01" value={editing.amount_off} onChange={set('amount_off')} />}
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Max uses" type="number" value={editing.max_redemptions ?? ''} onChange={set('max_redemptions')} />
              <Input label="Min. spend ($)" type="number" value={editing.min_subtotal} onChange={set('min_subtotal')} />
              <Input label="Expires" type="date" value={editing.expires_at} onChange={set('expires_at')} />
            </div>
            <Checkbox label="Active" checked={editing.is_active} onChange={set('is_active')} />
          </div>
        )}
      </Modal>
    </section>
  )
}
