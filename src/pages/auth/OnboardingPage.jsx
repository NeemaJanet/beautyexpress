import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, ChoiceGroup, FormError, Input, Select, TextArea } from '../../components/common/Field.jsx'
import { LoadingState } from '../../components/common/States.jsx'
import { LocationPicker } from '../../components/forms/LocationPicker.jsx'
import { SalonPicker } from '../../components/stylists/SalonPicker.jsx'
import { homePathFor, useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { TIMEZONES, userTimeZone, WEEKDAYS } from '../../lib/availability.js'
import { dollarsToCents } from '../../lib/pricing.js'
import { supabase } from '../../lib/supabase.js'
import { isPhone } from '../../lib/validation.js'
import { updateProfile } from '../../services/authService.js'
import { getCatalogServices } from '../../services/catalogService.js'
import { replaceDayWindows, saveService, updateStylistPrivate, updateStylistProfile } from '../../services/stylistService.js'
import { safeNext } from '../../utils/navigation.js'


export default function OnboardingPage() {
  useDocumentTitle('Set up your account')
  const auth = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [becoming, setBecoming] = useState(false)

  if (auth.loading || (auth.user && !auth.profile)) return <LoadingState className="min-h-[50vh]" />

  const wantsStylist = params.get('become') === 'stylist'
  if (wantsStylist && !auth.isStylist) {
    return (
      <div className="w-full max-w-md text-center">
        <h1 className="text-4xl">Offer your services</h1>
        <p className="mt-3 text-stone">Add a stylist profile to your account. You can still book appointments as a client.</p>
        <Button
          className="mt-6"
          loading={becoming}
          onClick={async () => {
            setBecoming(true)
            await supabase.rpc('become_stylist')
            await auth.refresh()
            setBecoming(false)
          }}
        >
          Create my stylist profile
        </Button>
      </div>
    )
  }

  const done = auth.isStylist ? auth.stylistProfile?.onboarding_completed : auth.profile?.onboarding_completed
  if (done || (auth.isAdmin && !auth.isStylist)) return <Navigate to={next || homePathFor(auth)} replace />

  return auth.isStylist ? <StylistOnboarding next={next} /> : <ClientOnboarding next={next} />
}

function ClientOnboarding({ next }) {
  const { user, profile, refresh } = useAuth()
  const navigate = useNavigate()
  const [v, setV] = useState({ full_name: profile.full_name || '', phone: profile.phone || '' })
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!v.full_name.trim()) return setError('Please enter your name.')
    if (v.phone && !isPhone(v.phone)) return setError('Enter a valid phone number, or leave it empty.')
    setBusy(true)
    setError(null)
    try {
      await updateProfile(user.id, {
        full_name: v.full_name.trim(),
        phone: v.phone.trim() || null,
        timezone: userTimeZone(),
        preferred_city: location?.label || null,
        preferred_lat: location?.lat ?? null,
        preferred_lng: location?.lng ?? null,
        onboarding_completed: true,
      })
      await refresh()
      navigate(next || '/explore', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-4xl">Welcome</h1>
      <p className="mt-2 text-stone">A couple of details so stylists know who is booking.</p>
      <form onSubmit={submit} className="panel mt-8 space-y-4 p-6">
        <FormError error={error} />
        <Input label="Your name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required />
        <Input label="Mobile number (optional)" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} hint="Only shared with stylists you book." />
        <div>
          <span className="label">Where do you usually book?</span>
          <LocationPicker id="onboarding-location" value={location} onChange={setLocation} />
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Start exploring
        </Button>
      </form>
    </div>
  )
}

const STEPS = ['About you', 'Where you work', 'First service', 'Working hours']

function StylistOnboarding() {
  const { user, profile, stylistProfile: sp, refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const catalog = useAsync(getCatalogServices, [])

  const [about, setAbout] = useState({
    display_name: sp.display_name || profile.full_name || '',
    business_name: sp.business_name || '',
    headline: sp.headline || '',
    bio: sp.bio || '',
    stylist_type: sp.stylist_type || 'freelance',
    years_experience: sp.years_experience || 0,
  })
  const [work, setWork] = useState({
    location: sp.approx_lat ? { label: sp.city, lat: sp.approx_lat, lng: sp.approx_lng } : null,
    province: sp.province || '',
    offers_mobile: sp.offers_mobile,
    offers_studio: sp.offers_studio,
    offers_salon: sp.offers_salon,
    max_travel_km: sp.max_travel_km || 15,
    travel_fee: '10',
    studio_address: '',
    salon: null,
  })
  const [service, setService] = useState({ service_id: '', title: '', price: '', duration: '120' })
  const [hours, setHours] = useState({ days: [2, 3, 4, 5, 6], start: '09:00', end: '18:00', timezone: TIMEZONES.includes(userTimeZone()) ? userTimeZone() : 'America/Halifax' })

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const saveAbout = () =>
    run(async () => {
      if (!about.display_name.trim()) throw new Error('Enter the name clients will see.')
      if (!about.headline.trim()) throw new Error('Add a short headline, e.g. “Knotless braids in Fredericton”.')
      await updateStylistProfile(user.id, {
        ...about,
        display_name: about.display_name.trim(),
        years_experience: Number(about.years_experience) || 0,
      })
      setStep(1)
    })

  const saveWork = () =>
    run(async () => {
      if (!work.location) throw new Error('Choose your city so clients nearby can find you.')
      if (!work.offers_mobile && !work.offers_studio && !work.offers_salon) throw new Error('Choose at least one place where you work.')
      if (work.offers_salon && !work.salon) throw new Error('Choose or add your salon.')
      if (work.offers_studio && !work.studio_address.trim()) throw new Error('Add your studio address (only confirmed clients see it).')
      const city = work.location.label.replace(/^Near /, '').split(',')[0].trim()
      await updateStylistProfile(user.id, {
        city,
        province: work.province || work.location.label.split(',')[1]?.trim() || '',
        approx_lat: work.location.lat,
        approx_lng: work.location.lng,
        offers_mobile: work.offers_mobile,
        offers_studio: work.offers_studio,
        offers_salon: work.offers_salon,
        stylist_type: work.offers_salon ? 'salon' : about.stylist_type,
        salon_id: work.salon?.id || null,
        max_travel_km: Number(work.max_travel_km) || 0,
        travel_fee_base_cents: dollarsToCents(work.travel_fee) || 0,
      })
      if (work.studio_address.trim()) await updateStylistPrivate(user.id, { studio_address: work.studio_address.trim() })
      setStep(2)
    })

  const saveFirstService = () =>
    run(async () => {
      const price = dollarsToCents(service.price)
      if (!service.service_id) throw new Error('Choose the hairstyle.')
      if (!price || price <= 0) throw new Error('Enter your price.')
      const locs = [work.offers_mobile && 'client_location', work.offers_studio && 'stylist_studio', work.offers_salon && 'salon'].filter(Boolean)
      const svc = catalog.data.find((c) => c.id === service.service_id)
      await saveService(user.id, {
        service_id: service.service_id,
        title: service.title.trim() || svc.name,
        base_price_cents: price,
        duration_minutes: Number(service.duration),
        location_types: locs,
      })
      setStep(3)
    })

  const finish = () =>
    run(async () => {
      if (!hours.days.length) throw new Error('Choose at least one working day.')
      if (hours.end <= hours.start) throw new Error('End time must be after start time.')
      await updateStylistProfile(user.id, { timezone: hours.timezone })
      for (let d = 0; d < 7; d++) {
        await replaceDayWindows(user.id, d, hours.days.includes(d) ? [{ start_time: hours.start, end_time: hours.end }] : [])
      }
      await updateStylistProfile(user.id, { onboarding_completed: true })
      await updateProfile(user.id, { onboarding_completed: true, timezone: hours.timezone })
      await refresh()
      navigate('/stylist/dashboard?welcome=1', { replace: true })
    })

  return (
    <div className="w-full max-w-xl">
      <h1 className="text-4xl">Set up your stylist profile</h1>
      <ol className="mt-6 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1 rounded-full ${i <= step ? 'bg-fuchsia' : 'bg-sand'}`} />
            <p className={`mt-2 text-xs ${i === step ? 'font-medium text-ink' : 'text-stone'}`}>
              {i + 1}. {s}
            </p>
          </li>
        ))}
      </ol>

      <div className="panel mt-6 space-y-4 p-6">
        <FormError error={error} />

        {step === 0 && (
          <>
            <Input label="Name clients will see" value={about.display_name} onChange={(e) => setAbout({ ...about, display_name: e.target.value })} required />
            <Input label="Business name (optional)" value={about.business_name} onChange={(e) => setAbout({ ...about, business_name: e.target.value })} />
            <Input label="Headline" maxLength={160} placeholder="Knotless braids and cornrows, mobile across Fredericton" value={about.headline} onChange={(e) => setAbout({ ...about, headline: e.target.value })} required />
            <TextArea label="About you (optional)" rows={4} maxLength={3000} value={about.bio} onChange={(e) => setAbout({ ...about, bio: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="I work as" value={about.stylist_type} onChange={(e) => setAbout({ ...about, stylist_type: e.target.value })}
                options={[{ value: 'freelance', label: 'Freelance stylist' }, { value: 'salon', label: 'Salon-based stylist' }]} />
              <Input label="Years of experience" type="number" min="0" max="80" value={about.years_experience} onChange={(e) => setAbout({ ...about, years_experience: e.target.value })} />
            </div>
            <Button onClick={saveAbout} loading={busy} className="w-full">Continue</Button>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <span className="label">Your city</span>
              <LocationPicker id="stylist-city" value={work.location} onChange={(location) => setWork({ ...work, location })} />
              <p className="mt-1.5 text-sm text-stone">Clients see your city and approximate distance, never your exact address.</p>
            </div>
            <fieldset className="space-y-3">
              <legend className="label">Where do you do hair?</legend>
              <Checkbox label="I travel to clients" hint="Mobile appointments at the client’s home" checked={work.offers_mobile} onChange={(e) => setWork({ ...work, offers_mobile: e.target.checked })} />
              <Checkbox label="My own studio or home studio" checked={work.offers_studio} onChange={(e) => setWork({ ...work, offers_studio: e.target.checked })} />
              <Checkbox label="A salon" checked={work.offers_salon} onChange={(e) => setWork({ ...work, offers_salon: e.target.checked })} />
            </fieldset>
            {work.offers_mobile && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Maximum travel distance (km)" type="number" min="1" max="300" value={work.max_travel_km} onChange={(e) => setWork({ ...work, max_travel_km: e.target.value })} />
                <Input label="Travel fee ($)" type="number" min="0" step="0.01" value={work.travel_fee} onChange={(e) => setWork({ ...work, travel_fee: e.target.value })} hint="Flat fee per mobile visit. Add a per-km fee later." />
              </div>
            )}
            {work.offers_studio && (
              <Input label="Studio address" value={work.studio_address} onChange={(e) => setWork({ ...work, studio_address: e.target.value })} hint="Private. Shown only to clients with a confirmed booking." />
            )}
            {work.offers_salon && (
              <div>
                <span className="label">Your salon</span>
                <SalonPicker stylistId={user.id} current={work.salon} onChange={(salon) => setWork({ ...work, salon })} />
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={saveWork} loading={busy}>Continue</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-stone">Add one service now. You can add more, with options like length and add-ons, from your dashboard.</p>
            <Select label="Hairstyle" value={service.service_id} placeholder="Choose a hairstyle"
              onChange={(e) => {
                const svc = catalog.data?.find((c) => c.id === e.target.value)
                setService({ ...service, service_id: e.target.value, title: svc?.name || '', duration: String(svc?.typical_duration_minutes || 120) })
              }}
              options={(catalog.data || []).map((c) => ({ value: c.id, label: `${c.name} (${c.service_categories?.name})` }))} />
            <Input label="Title shown to clients" value={service.title} onChange={(e) => setService({ ...service, title: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Price ($)" type="number" min="0" step="0.01" value={service.price} onChange={(e) => setService({ ...service, price: e.target.value })} required />
              <Select label="How long it takes" value={service.duration} onChange={(e) => setService({ ...service, duration: e.target.value })}
                options={[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480].map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h` }))} />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={saveFirstService} loading={busy}>Continue</Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <fieldset>
              <legend className="label">Days you work</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${hours.days.includes(i) ? 'border-brown-deep bg-brown-deep text-cream' : 'border-sand bg-paper'}`}>
                    <input type="checkbox" className="sr-only" checked={hours.days.includes(i)}
                      onChange={(e) => setHours({ ...hours, days: e.target.checked ? [...hours.days, i] : hours.days.filter((x) => x !== i) })} />
                    {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Start time" type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
              <Input label="End time" type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
            </div>
            <Select label="Time zone" value={hours.timezone} onChange={(e) => setHours({ ...hours, timezone: e.target.value })} options={TIMEZONES.map((t) => ({ value: t, label: t.replace('America/', '').replace('_', ' ') }))} />
            <ChoiceGroup label="Booking style" name="mode" value={sp.booking_mode} onChange={(m) => updateStylistProfile(user.id, { booking_mode: m }).then(refresh)}
              options={[{ value: 'approval', label: 'I approve each request' }, { value: 'instant', label: 'Instant booking' }]} />
            <p className="text-sm text-stone">You can add breaks, days off and more detailed hours later.</p>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={finish} loading={busy} variant="accent">Publish my profile</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
