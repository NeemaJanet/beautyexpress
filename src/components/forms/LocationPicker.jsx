import { useState } from 'react'
import { CITIES } from '../../lib/cities.js'
import { geocode, getDeviceLocation, isMapsConfigured, nearestCity } from '../../lib/maps.js'
import { Button } from '../common/Button.jsx'

/**
 * Choose an approximate location for search: type a city/postal code/address,
 * pick from the list, or use the device location.
 * value = { label, lat, lng } | null
 */
export function LocationPicker({ value, onChange, compact = false, id = 'location' }) {
  const [text, setText] = useState(value?.label || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const lookup = async () => {
    if (!text.trim()) {
      onChange(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await geocode(text)
      if (!r) {
        setError(isMapsConfigured ? 'We could not find that place.' : 'Pick a city from the list (address search is not set up yet).')
        return
      }
      setText(r.label)
      onChange({ label: r.label, lat: r.lat, lng: r.lng })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const useDevice = async () => {
    setBusy(true)
    setError(null)
    try {
      const pos = await getDeviceLocation()
      const city = nearestCity(pos.lat, pos.lng)
      const label = city ? `Near ${city.name}` : 'Current location'
      setText(label)
      onChange({ label, ...pos })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className={`flex gap-2 ${compact ? '' : 'flex-col sm:flex-row'}`}>
        <input
          id={id}
          list={`${id}-cities`}
          className="control"
          placeholder={isMapsConfigured ? 'City, postal code or address' : 'City'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (value?.label || '') && lookup()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              lookup()
            }
          }}
          aria-label="Location"
        />
        <datalist id={`${id}-cities`}>
          {CITIES.map((c) => (
            <option key={c.name} value={`${c.name}, ${c.province}`} />
          ))}
        </datalist>
        <Button variant="secondary" size="sm" onClick={useDevice} loading={busy} className="shrink-0">
          Use my location
        </Button>
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
      {value && (
        <button type="button" className="mt-1.5 text-sm text-stone underline" onClick={() => { setText(''); onChange(null) }}>
          Clear location
        </button>
      )}
    </div>
  )
}
