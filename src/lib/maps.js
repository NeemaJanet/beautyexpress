/**
 * Maps provider integration (geocoding: turning an address into coordinates).
 *
 * Configure ONE provider in .env:
 *   VITE_MAPS_PROVIDER=mapbox   + VITE_MAPBOX_TOKEN=pk.xxx   (public token, URL-restricted)
 *   VITE_MAPS_PROVIDER=google   + VITE_GOOGLE_MAPS_KEY=xxx   (browser key, HTTP-referrer restricted)
 *
 * Without a provider the app still works: people pick their city from a list
 * (src/lib/cities.js) or share their device location, and distances are
 * calculated from those approximate points.
 */
import { CITIES, findCity } from './cities.js'

const provider = (import.meta.env.VITE_MAPS_PROVIDER || '').toLowerCase()
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
const googleKey = import.meta.env.VITE_GOOGLE_MAPS_KEY

export const mapsProvider =
  provider === 'mapbox' && mapboxToken ? 'mapbox' : provider === 'google' && googleKey ? 'google' : null

export const isMapsConfigured = Boolean(mapsProvider)

/**
 * Geocode free text. Returns { lat, lng, label, city, province } or null.
 * Falls back to the built-in city list when no provider is configured.
 */
export async function geocode(text, { country = 'ca' } = {}) {
  const query = String(text || '').trim()
  if (!query) return null

  if (mapsProvider === 'mapbox') {
    const url = new URL(`https://api.mapbox.com/search/geocode/v6/forward`)
    url.searchParams.set('q', query)
    url.searchParams.set('country', country)
    url.searchParams.set('limit', '1')
    url.searchParams.set('access_token', mapboxToken)
    const res = await fetch(url)
    if (!res.ok) throw new Error('Address lookup failed')
    const f = (await res.json()).features?.[0]
    if (!f) return null
    const [lng, lat] = f.geometry.coordinates
    const ctx = f.properties?.context || {}
    return { lat, lng, label: f.properties?.full_address || query, city: ctx.place?.name, province: ctx.region?.region_code }
  }

  if (mapsProvider === 'google') {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', query)
    url.searchParams.set('components', `country:${country}`)
    url.searchParams.set('key', googleKey)
    const res = await fetch(url)
    if (!res.ok) throw new Error('Address lookup failed')
    const r = (await res.json()).results?.[0]
    if (!r) return null
    const comp = (type) => r.address_components.find((c) => c.types.includes(type))
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      label: r.formatted_address,
      city: comp('locality')?.long_name,
      province: comp('administrative_area_level_1')?.short_name,
    }
  }

  // Manual fallback: match a known city name inside the text.
  const direct = findCity(query)
  const match =
    direct || CITIES.find((c) => query.toLowerCase().includes(c.name.toLowerCase())) || null
  return match ? { lat: match.lat, lng: match.lng, label: `${match.name}, ${match.province}`, city: match.name, province: match.province, approximate: true } : null
}

/** Ask the browser for the device location (needs the user's permission). */
export function getDeviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Location permission was denied. Choose your city instead.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  })
}

/** Nearest known city to a point (to show a friendly label). */
export function nearestCity(lat, lng) {
  let best = null
  let bestD = Infinity
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** Link to open a location in the user's map app (no API key needed). */
export function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
