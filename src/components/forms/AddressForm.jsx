import { useState } from 'react'
import { geocode, isMapsConfigured } from '../../lib/maps.js'
import { normalizePostalCode, required, validate } from '../../lib/validation.js'
import { Button } from '../common/Button.jsx'
import { Checkbox, FormError, Input, TextArea } from '../common/Field.jsx'

const empty = { label: 'Home', line1: '', line2: '', city: '', province: '', postal_code: '', access_notes: '', is_default: false }

/** Create or edit a saved address. Coordinates are looked up for travel-fee calculation. */
export function AddressForm({ initial, onSave, onCancel }) {
  const [v, setV] = useState({ ...empty, ...initial })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(v, {
      label: [required()],
      line1: [required('Enter the street address.')],
      city: [required('Enter the city.')],
    })
    if (v.postal_code && v.country !== 'US' && !normalizePostalCode(v.postal_code)) {
      errs.postal_code = 'Use the format A1A 1A1.'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setFormError(null)
    try {
      let coords = { lat: v.lat ?? null, lng: v.lng ?? null }
      const changed = !initial || ['line1', 'city', 'postal_code', 'province'].some((k) => initial[k] !== v[k])
      if (changed) {
        const full = [v.line1, v.city, v.province, v.postal_code].filter(Boolean).join(', ')
        const geo = await geocode(isMapsConfigured ? full : v.city).catch(() => null)
        coords = geo ? { lat: geo.lat, lng: geo.lng } : { lat: null, lng: null }
      }
      await onSave({
        label: v.label.trim(),
        line1: v.line1.trim(),
        line2: v.line2?.trim() || null,
        city: v.city.trim(),
        province: v.province.trim(),
        postal_code: normalizePostalCode(v.postal_code) || v.postal_code.trim(),
        access_notes: v.access_notes?.trim() || null,
        is_default: v.is_default,
        ...coords,
      })
    } catch (err) {
      setFormError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError error={formError} />
      <Input label="Label" value={v.label} onChange={set('label')} error={errors.label} placeholder="Home, Work…" required />
      <Input label="Street address" value={v.line1} onChange={set('line1')} error={errors.line1} autoComplete="address-line1" required />
      <Input label="Apartment, suite (optional)" value={v.line2 || ''} onChange={set('line2')} autoComplete="address-line2" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="City" value={v.city} onChange={set('city')} error={errors.city} autoComplete="address-level2" required />
        <Input label="Province" value={v.province} onChange={set('province')} autoComplete="address-level1" placeholder="NB" />
        <Input label="Postal code" value={v.postal_code} onChange={set('postal_code')} error={errors.postal_code} autoComplete="postal-code" />
      </div>
      <TextArea
        label="Access notes (optional)"
        rows={2}
        value={v.access_notes || ''}
        onChange={set('access_notes')}
        hint="Buzzer code, parking, stairs. Shared with your stylist only after they confirm a booking."
      />
      <Checkbox label="Use as my default address" checked={v.is_default} onChange={set('is_default')} />
      {!isMapsConfigured && (
        <p className="text-sm text-stone">
          Distance is estimated from your city because address lookup is not set up. Stylists may confirm travel before accepting.
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Save address
        </Button>
      </div>
    </form>
  )
}
