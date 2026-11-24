/**
 * Approximate centre points of Canadian cities. Used as the MANUAL location
 * fallback when no maps API key is configured, so distance search still works.
 * Add your own cities as you expand.
 */
export const CITIES = [
  { name: 'Fredericton', province: 'NB', lat: 45.9636, lng: -66.6431 },
  { name: 'Moncton', province: 'NB', lat: 46.0878, lng: -64.7782 },
  { name: 'Saint John', province: 'NB', lat: 45.2733, lng: -66.0633 },
  { name: 'Dieppe', province: 'NB', lat: 46.0984, lng: -64.7242 },
  { name: 'Oromocto', province: 'NB', lat: 45.8488, lng: -66.4787 },
  { name: 'Halifax', province: 'NS', lat: 44.6488, lng: -63.5752 },
  { name: 'Dartmouth', province: 'NS', lat: 44.6713, lng: -63.5772 },
  { name: 'Sydney', province: 'NS', lat: 46.1368, lng: -60.1942 },
  { name: 'Charlottetown', province: 'PE', lat: 46.2382, lng: -63.1311 },
  { name: "St. John's", province: 'NL', lat: 47.5615, lng: -52.7126 },
  { name: 'Quebec City', province: 'QC', lat: 46.8139, lng: -71.208 },
  { name: 'Montreal', province: 'QC', lat: 45.5019, lng: -73.5674 },
  { name: 'Gatineau', province: 'QC', lat: 45.4765, lng: -75.7013 },
  { name: 'Ottawa', province: 'ON', lat: 45.4215, lng: -75.6972 },
  { name: 'Toronto', province: 'ON', lat: 43.6532, lng: -79.3832 },
  { name: 'Mississauga', province: 'ON', lat: 43.589, lng: -79.6441 },
  { name: 'Brampton', province: 'ON', lat: 43.7315, lng: -79.7624 },
  { name: 'Hamilton', province: 'ON', lat: 43.2557, lng: -79.8711 },
  { name: 'London', province: 'ON', lat: 42.9849, lng: -81.2453 },
  { name: 'Windsor', province: 'ON', lat: 42.3149, lng: -83.0364 },
  { name: 'Kitchener', province: 'ON', lat: 43.4516, lng: -80.4925 },
  { name: 'Winnipeg', province: 'MB', lat: 49.8951, lng: -97.1384 },
  { name: 'Regina', province: 'SK', lat: 50.4452, lng: -104.6189 },
  { name: 'Saskatoon', province: 'SK', lat: 52.1332, lng: -106.67 },
  { name: 'Calgary', province: 'AB', lat: 51.0447, lng: -114.0719 },
  { name: 'Edmonton', province: 'AB', lat: 53.5461, lng: -113.4938 },
  { name: 'Vancouver', province: 'BC', lat: 49.2827, lng: -123.1207 },
  { name: 'Surrey', province: 'BC', lat: 49.1913, lng: -122.849 },
  { name: 'Victoria', province: 'BC', lat: 48.4284, lng: -123.3656 },
]

export function findCity(text) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  return (
    CITIES.find((c) => c.name.toLowerCase() === q) ||
    CITIES.find((c) => `${c.name}, ${c.province}`.toLowerCase() === q) ||
    CITIES.find((c) => c.name.toLowerCase().startsWith(q)) ||
    null
  )
}
