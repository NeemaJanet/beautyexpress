import { useState } from 'react'
import { geocode } from '../../lib/maps.js'
import { createSalon, joinSalon, searchSalons } from '../../services/stylistService.js'
import { Button } from '../common/Button.jsx'
import { FormError, Input } from '../common/Field.jsx'

/** Find an existing salon or add a new one, then link it to the stylist. */
export function SalonPicker({ stylistId, current, onChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', address_line: '', city: '', province: '', postal_code: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const search = async () => {
    if (query.trim().length < 2) return
    setBusy(true)
    setError(null)
    try {
      setResults(await searchSalons(query.trim()))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (salon) => {
    setBusy(true)
    try {
      await joinSalon(stylistId, salon.id)
      onChange(salon)
      setResults(null)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (form.name.trim().length < 2 || form.address_line.trim().length < 3 || form.city.trim().length < 2) {
      setError('Enter the salon name, street address and city.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const geo = await geocode(`${form.address_line}, ${form.city}, ${form.province}`).catch(() => null)
      const salon = await createSalon(stylistId, {
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || (k === 'phone' ? null : '')])),
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
      })
      onChange(salon)
      setCreating(false)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {current && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-sand-soft px-4 py-3 text-sm">
          <div>
            <p className="font-medium">{current.name}</p>
            <p className="text-stone">{[current.address_line, current.city].filter(Boolean).join(', ')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      )}
      <FormError error={error} />
      {!creating ? (
        <>
          <div className="flex gap-2">
            <input
              className="control"
              placeholder="Search salons by name or city"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
              aria-label="Search salons"
            />
            <Button variant="secondary" onClick={search} loading={busy}>
              Search
            </Button>
          </div>
          {results && (
            <ul className="divide-y divide-sand rounded-[var(--radius-control)] border border-sand">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-stone">No salons found.</li>}
              {results.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    {s.name} <span className="text-stone">— {s.city}</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => pick(s)}>
                    Choose
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link text-sm" onClick={() => setCreating(true)}>
            My salon is not listed — add it
          </button>
        </>
      ) : (
        <div className="space-y-3 rounded-[var(--radius-control)] border border-sand p-4">
          <Input label="Salon name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Street address" value={form.address_line} onChange={(e) => setForm({ ...form, address_line: e.target.value })} hint="Salon addresses are public." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Input label="Province" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            <Input label="Postal code" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
          </div>
          <Input label="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="flex gap-2">
            <Button onClick={create} loading={busy}>
              Add salon
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
