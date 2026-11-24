import { useState } from 'react'
import { calculatePrice, centsToDollars, dollarsToCents, formatMoney } from '../../lib/pricing.js'
import { LOCATION_LABELS } from '../../lib/bookingStatus.js'
import { friendlyError } from '../../lib/validation.js'
import { Button } from '../common/Button.jsx'
import { Checkbox, FormError, Input, Select, TextArea } from '../common/Field.jsx'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480, 540, 600]

/**
 * Create / edit a stylist service. `stylist` decides which locations can be
 * offered. `settings` (public platform settings) powers the earnings preview.
 */
export function ServiceEditor({ initial, catalog, stylist, settings, onSave, onCancel }) {
  const allowedLocations = [
    stylist.offers_mobile && 'client_location',
    stylist.offers_studio && 'stylist_studio',
    stylist.offers_salon && 'salon',
  ].filter(Boolean)
  const [v, setV] = useState({
    service_id: initial?.service_id || '',
    title: initial?.title || '',
    description: initial?.description || '',
    price: initial ? centsToDollars(initial.base_price_cents) : '',
    duration_minutes: String(initial?.duration_minutes || 120),
    deposit_type: initial?.deposit_type || 'none',
    deposit_value: initial?.deposit_type === 'fixed' ? centsToDollars(initial.deposit_value) : String(initial?.deposit_value || ''),
    booking_mode: initial?.booking_mode || '',
    location_types: initial?.location_types || allowedLocations,
    is_active: initial?.is_active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const priceCents = dollarsToCents(v.price) || 0
  const preview = calculatePrice({
    basePriceCents: priceCents,
    baseDurationMinutes: Number(v.duration_minutes),
    settings: {
      serviceFeePercent: Number(settings?.service_fee_percent ?? 0),
      taxPercent: Number(settings?.tax_percent ?? 0),
      commissionPercent: Number(settings?.commission_percent ?? 0),
    },
  })

  const submit = async (e) => {
    e.preventDefault()
    if (!v.service_id) return setError('Choose the hairstyle this service belongs to.')
    if (!v.title.trim()) return setError('Add a title.')
    if (priceCents <= 0) return setError('Enter a price greater than zero.')
    if (!v.location_types.length) return setError('Choose at least one location.')
    let depositValue = 0
    if (v.deposit_type === 'percent') {
      depositValue = Math.round(Number(v.deposit_value))
      if (!(depositValue >= 1 && depositValue <= 100)) return setError('Deposit percentage must be between 1 and 100.')
    } else if (v.deposit_type === 'fixed') {
      depositValue = dollarsToCents(v.deposit_value) || 0
      if (depositValue <= 0) return setError('Enter the deposit amount.')
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({
        id: initial?.id,
        service_id: v.service_id,
        title: v.title.trim(),
        description: v.description.trim(),
        base_price_cents: priceCents,
        duration_minutes: Number(v.duration_minutes),
        deposit_type: v.deposit_type,
        deposit_value: depositValue,
        booking_mode: v.booking_mode || null,
        location_types: v.location_types,
        is_active: v.is_active,
      })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError error={error} />
      <Select label="Hairstyle" value={v.service_id} placeholder="Choose a hairstyle" required
        onChange={(e) => {
          const c = catalog.find((x) => x.id === e.target.value)
          setV({ ...v, service_id: e.target.value, title: v.title || c?.name || '', duration_minutes: initial ? v.duration_minutes : String(c?.typical_duration_minutes || 120) })
        }}
        options={catalog.map((c) => ({ value: c.id, label: `${c.name} (${c.service_categories?.name})` }))} />
      <Input label="Title shown to clients" value={v.title} maxLength={120} onChange={set('title')} required />
      <TextArea label="Description" rows={3} maxLength={2000} value={v.description} onChange={set('description')} hint="What’s included, hair provided or not, how to prepare." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Base price ($)" type="number" min="0" step="0.01" value={v.price} onChange={set('price')} required />
        <Select label="Duration" value={v.duration_minutes} onChange={set('duration_minutes')}
          options={DURATIONS.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Payment at booking" value={v.deposit_type} onChange={set('deposit_type')}
          options={[{ value: 'none', label: 'Full amount' }, { value: 'percent', label: 'Deposit (%)' }, { value: 'fixed', label: 'Deposit (fixed $)' }]}
          hint="Applies when online card payments are on." />
        {v.deposit_type !== 'none' && (
          <Input label={v.deposit_type === 'percent' ? 'Deposit %' : 'Deposit ($)'} type="number" min="0" step={v.deposit_type === 'percent' ? '1' : '0.01'} value={v.deposit_value} onChange={set('deposit_value')} />
        )}
      </div>
      <Select label="Booking style for this service" value={v.booking_mode} onChange={set('booking_mode')}
        options={[{ value: '', label: 'Use my default' }, { value: 'instant', label: 'Instant booking' }, { value: 'approval', label: 'I approve each request' }]} />
      <fieldset className="space-y-2">
        <legend className="label">Offered at</legend>
        {['client_location', 'stylist_studio', 'salon'].map((l) => (
          <Checkbox key={l} label={LOCATION_LABELS[l]} disabled={!allowedLocations.includes(l)}
            hint={!allowedLocations.includes(l) ? 'Turn this on in your public profile first.' : undefined}
            checked={v.location_types.includes(l)}
            onChange={(e) => setV({ ...v, location_types: e.target.checked ? [...v.location_types, l] : v.location_types.filter((x) => x !== l) })} />
        ))}
      </fieldset>
      <Checkbox label="Visible and bookable" checked={v.is_active} onChange={set('is_active')} />
      {priceCents > 0 && (
        <div className="rounded-[var(--radius-control)] bg-sand-soft p-4 text-sm">
          <p>Client pays {formatMoney(preview.totalCents)} (includes {formatMoney(preview.serviceFeeCents)} booking fee{preview.taxCents ? ` and ${formatMoney(preview.taxCents)} tax` : ''}).</p>
          <p className="mt-1 font-medium">You earn about {formatMoney(preview.stylistEarningsCents)} after the {settings?.commission_percent ?? 0}% platform commission.</p>
          <p className="mt-1 text-xs text-stone">Before options, discounts and travel fees.</p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>Save service</Button>
      </div>
    </form>
  )
}
