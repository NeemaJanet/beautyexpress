import { useState } from 'react'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, FormError, Input, Select, TextArea } from '../../components/common/Field.jsx'
import { ImageUpload } from '../../components/common/ImageUpload.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { LoadingState } from '../../components/common/States.jsx'
import { LocationPicker } from '../../components/forms/LocationPicker.jsx'
import { SalonPicker } from '../../components/stylists/SalonPicker.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { centsToDollars, dollarsToCents } from '../../lib/pricing.js'
import { friendlyError } from '../../lib/validation.js'
import { addArea, deleteArea, getMyStylistPrivate, getMyStylistProfile, listAreas, updateStylistPrivate, updateStylistProfile } from '../../services/stylistService.js'

export default function StylistProfileEditorPage() {
  useDocumentTitle('Public profile')
  const { user } = useAuth()
  const data = useAsync(async () => {
    const [profile, priv, areas] = await Promise.all([getMyStylistProfile(user.id), getMyStylistPrivate(user.id), listAreas(user.id)])
    return { profile, priv, areas }
  }, [user.id])
  if (data.loading || !data.data) return <LoadingState />
  return <Editor initial={data.data} userId={user.id} reload={data.reload} />
}

function Editor({ initial, userId, reload }) {
  const { refresh } = useAuth()
  const toast = useToast()
  const p = initial.profile
  const [v, setV] = useState({
    display_name: p.display_name,
    business_name: p.business_name,
    headline: p.headline,
    bio: p.bio,
    stylist_type: p.stylist_type,
    years_experience: p.years_experience,
    province: p.province,
    offers_mobile: p.offers_mobile,
    offers_studio: p.offers_studio,
    offers_salon: p.offers_salon,
    max_travel_km: p.max_travel_km,
    travel_fee_base: centsToDollars(p.travel_fee_base_cents),
    travel_fee_per_km: centsToDollars(p.travel_fee_per_km_cents),
    studio_address: initial.priv.studio_address || '',
    business_phone: initial.priv.business_phone || '',
  })
  const [loc, setLoc] = useState(p.approx_lat ? { label: p.city, lat: p.approx_lat, lng: p.approx_lng } : null)
  const [salon, setSalon] = useState(p.salons || null)
  const [avatar, setAvatar] = useState(p.avatar_url)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [areaLoc, setAreaLoc] = useState(null)
  const [areaRadius, setAreaRadius] = useState('10')
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async (e) => {
    e.preventDefault()
    if (!v.display_name.trim()) return setError('Your display name is required.')
    if (!loc) return setError('Choose your city.')
    if (!v.offers_mobile && !v.offers_studio && !v.offers_salon) return setError('Choose at least one place where you work.')
    if (v.offers_salon && !salon) return setError('Choose your salon, or untick “A salon”.')
    setBusy(true)
    setError(null)
    try {
      await updateStylistProfile(userId, {
        display_name: v.display_name.trim(),
        business_name: v.business_name.trim(),
        headline: v.headline.trim(),
        bio: v.bio.trim(),
        stylist_type: v.stylist_type,
        years_experience: Number(v.years_experience) || 0,
        city: loc.label.replace(/^Near /, '').split(',')[0].trim(),
        province: v.province.trim() || loc.label.split(',')[1]?.trim() || '',
        approx_lat: loc.lat,
        approx_lng: loc.lng,
        offers_mobile: v.offers_mobile,
        offers_studio: v.offers_studio,
        offers_salon: v.offers_salon,
        salon_id: v.offers_salon ? salon?.id : null,
        max_travel_km: Number(v.max_travel_km) || 0,
        travel_fee_base_cents: dollarsToCents(v.travel_fee_base) || 0,
        travel_fee_per_km_cents: dollarsToCents(v.travel_fee_per_km) || 0,
        avatar_url: avatar,
      })
      await updateStylistPrivate(userId, { studio_address: v.studio_address.trim() || null, business_phone: v.business_phone.trim() || null })
      await refresh()
      toast.success('Profile saved')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const addServiceArea = async () => {
    if (!areaLoc) return
    try {
      await addArea({ stylist_id: userId, label: areaLoc.label, lat: areaLoc.lat, lng: areaLoc.lng, radius_km: Number(areaRadius) || 10 })
      setAreaLoc(null)
      reload()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Public profile" description="What clients see when they find you." actions={<Button variant="secondary" to={`/stylists/${userId}`}>Preview</Button>} />
      <form onSubmit={save} className="space-y-8">
        <section className="panel space-y-5 p-6">
          <SectionTitle>About you</SectionTitle>
          <div className="flex items-center gap-4">
            <Avatar src={avatar} name={v.display_name} size="lg" />
            <ImageUpload bucket="avatars" userId={userId} label="Upload photo" onUploaded={({ url }) => setAvatar(url)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Display name" value={v.display_name} onChange={set('display_name')} required />
            <Input label="Business name" value={v.business_name} onChange={set('business_name')} />
          </div>
          <Input label="Headline" maxLength={160} value={v.headline} onChange={set('headline')} hint="One line about what you do best." />
          <TextArea label="Bio" rows={6} maxLength={3000} value={v.bio} onChange={set('bio')} hint="Your experience, specialities, hair care approach and anything clients should know." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Stylist type" value={v.stylist_type} onChange={set('stylist_type')} options={[{ value: 'freelance', label: 'Freelance' }, { value: 'salon', label: 'Salon-based' }]} />
            <Input label="Years of experience" type="number" min="0" max="80" value={v.years_experience} onChange={set('years_experience')} />
          </div>
        </section>

        <section className="panel space-y-5 p-6">
          <SectionTitle>Location and where you work</SectionTitle>
          <div>
            <span className="label">City</span>
            <LocationPicker id="editor-city" value={loc} onChange={setLoc} />
            <p className="mt-1.5 text-sm text-stone">Shown publicly as your city and a distance rounded to about 1 km.</p>
          </div>
          <Input label="Province" value={v.province} onChange={set('province')} />
          <div className="space-y-3">
            <Checkbox label="I travel to clients (mobile)" checked={v.offers_mobile} onChange={set('offers_mobile')} />
            <Checkbox label="My own studio" checked={v.offers_studio} onChange={set('offers_studio')} />
            <Checkbox label="A salon" checked={v.offers_salon} onChange={set('offers_salon')} />
          </div>
          {v.offers_studio && (
            <Input label="Studio address (private)" value={v.studio_address} onChange={set('studio_address')} hint="Shown only to clients with a confirmed studio booking." />
          )}
          {v.offers_salon && (
            <div>
              <span className="label">Salon</span>
              <SalonPicker stylistId={userId} current={salon} onChange={setSalon} />
            </div>
          )}
          <Input label="Business phone (private)" type="tel" value={v.business_phone} onChange={set('business_phone')} />
        </section>

        {v.offers_mobile && (
          <section className="panel space-y-5 p-6">
            <SectionTitle>Travel</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Max distance (km)" type="number" min="0" max="300" value={v.max_travel_km} onChange={set('max_travel_km')} />
              <Input label="Base travel fee ($)" type="number" min="0" step="0.01" value={v.travel_fee_base} onChange={set('travel_fee_base')} />
              <Input label="Per km ($)" type="number" min="0" step="0.01" value={v.travel_fee_per_km} onChange={set('travel_fee_per_km')} />
            </div>
            <p className="text-sm text-stone">Clients see the travel fee before booking. Distance is measured from your city centre point.</p>
          </section>
        )}

        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" loading={busy} size="lg">Save profile</Button>
        </div>
      </form>

      {v.offers_mobile && (
        <section className="panel space-y-4 p-6">
          <SectionTitle>Extra service areas</SectionTitle>
          <p className="text-sm text-stone">Add towns outside your normal travel distance that you also serve.</p>
          <ul className="space-y-2">
            {initial.areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-[var(--radius-control)] bg-sand-soft px-4 py-2 text-sm">
                <span>{a.label}, within {a.radius_km} km</span>
                <Button variant="ghost" size="sm" onClick={async () => { await deleteArea(a.id); reload() }}>Remove</Button>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
            <div><span className="label">Area</span><LocationPicker id="area-loc" value={areaLoc} onChange={setAreaLoc} compact /></div>
            <Input label="Radius (km)" type="number" min="1" max="300" value={areaRadius} onChange={(e) => setAreaRadius(e.target.value)} />
            <Button variant="secondary" onClick={addServiceArea} disabled={!areaLoc}>Add area</Button>
          </div>
        </section>
      )}
    </div>
  )
}
