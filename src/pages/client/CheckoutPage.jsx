import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Button } from '../../components/common/Button.jsx'
import { ChoiceGroup, FormError, Input, TextArea } from '../../components/common/Field.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { PriceBreakdown } from '../../components/bookings/PriceBreakdown.jsx'
import { SlotPicker } from '../../components/bookings/SlotPicker.jsx'
import { AddressForm } from '../../components/forms/AddressForm.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../lib/availability.js'
import { LOCATION_LABELS, PAYMENT_PROVIDER_LABELS } from '../../lib/bookingStatus.js'
import { formatDuration, formatMoney } from '../../lib/pricing.js'
import { supabase, unwrap } from '../../lib/supabase.js'
import { isPhone, friendlyError } from '../../lib/validation.js'
import { createBooking, getQuote } from '../../services/bookingService.js'
import { getStylistService } from '../../services/stylistService.js'

function groupOptions(options) {
  const groups = {}
  for (const o of (options || []).filter((x) => x.is_active).sort((a, b) => a.sort_order - b.sort_order)) {
    groups[o.group_name] ??= { name: o.group_name, type: o.group_type, options: [] }
    groups[o.group_name].options.push(o)
  }
  return Object.values(groups)
}

export default function CheckoutPage() {
  const { serviceId } = useParams()
  const { user, profile, isSuspended } = useAuth()
  const navigate = useNavigate()
  const svc = useAsync(() => getStylistService(serviceId), [serviceId])
  const addresses = useAsync(
    async () => unwrap(await supabase.from('addresses').select('*').eq('user_id', user.id).order('is_default', { ascending: false })),
    [user.id],
  )
  useDocumentTitle(svc.data ? `Book ${svc.data.title}` : 'Book')

  const groups = useMemo(() => groupOptions(svc.data?.service_options), [svc.data])
  const [choices, setChoices] = useState({}) // group name -> option id (choose_one)
  const [addons, setAddons] = useState([]) // option ids
  const [locationType, setLocationType] = useState(null)
  const [addressId, setAddressId] = useState(null)
  const [slot, setSlot] = useState(null)
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState('')
  const [provider, setProvider] = useState(null)
  const [notes, setNotes] = useState('')
  const [phone, setPhone] = useState(profile?.phone || '')
  const [addingAddress, setAddingAddress] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const service = svc.data
  const sp = service?.stylist_profiles
  // Defaults: first option in each "choose one" group, first location, default address.
  const effectiveChoices = Object.fromEntries(groups.filter((g) => g.type === 'choose_one').map((g) => [g.name, choices[g.name] || g.options[0].id]))
  const optionIds = [...Object.values(effectiveChoices), ...addons]
    const loc = locationType || (addresses.data?.length ? service?.location_types?.[0] : service?.location_types?.find((l) => l !== 'client_location')) || service?.location_types?.[0]
  const address = addresses.data?.find((a) => a.id === (addressId || addresses.data?.[0]?.id))

  const quote = useAsync(
    () =>
      getQuote({
        serviceId,
        optionIds,
        locationType: loc,
        lat: loc === 'client_location' ? address?.lat : null,
        lng: loc === 'client_location' ? address?.lng : null,
        promoCode: promo,
      }),
    [serviceId, optionIds.join(','), loc, address?.id, promo],
    { enabled: Boolean(service && loc) },
  )

  if (svc.loading || addresses.loading) return <LoadingState className="min-h-[60vh]" />
  if (!service || !service.is_active)
    return (
      <div className="container-page py-16">
        <EmptyState title="This service can’t be booked" action={<Button to="/explore">Find a stylist</Button>} />
      </div>
    )
  if (service.stylist_id === user.id)
    return (
      <div className="container-page py-16">
        <EmptyState title="You can’t book your own service" action={<Button to="/stylist/services">Manage services</Button>} />
      </div>
    )

  const q = quote.data
  const payOptions = q?.payment_options || {}
  const availableProviders = ['stripe', 'manual_etransfer', 'pay_in_person'].filter((p) => payOptions[p])
  const chosenProvider = provider && availableProviders.includes(provider) ? provider : availableProviders[0]
  const needsAddress = loc === 'client_location'
  const canSubmit = slot && q && !quote.error && (!needsAddress || address) && chosenProvider && !isSuspended

  const submit = async () => {
    if (phone && !isPhone(phone)) {
      setSubmitError('Enter a valid phone number or leave it empty.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const r = await createBooking({
        serviceId,
        optionIds,
        startsAt: slot,
        locationType: loc,
        addressId: needsAddress ? address.id : null,
        notes,
        promoCode: promo,
        paymentProvider: chosenProvider,
        contactPhone: phone,
      })
      navigate(r.requires_online_payment ? `/bookings/${r.booking_id}?pay=1` : `/bookings/${r.booking_id}/confirmed`, { replace: true })
    } catch (e) {
      setSubmitError(friendlyError(e))
      if (/no longer available|just booked/i.test(e.message)) setSlot(null)
      setSubmitting(false)
    }
  }

  return (
    <div className="container-page py-10">
      <Link to={`/stylists/${service.stylist_id}`} className="text-sm text-stone hover:text-ink">
        Back to {sp.display_name}
      </Link>
      <h1 className="mt-3 text-4xl">Book {service.title}</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-10">
          {/* 1. Options */}
          {groups.length > 0 && (
            <section aria-labelledby="step-options">
              <h2 id="step-options" className="mb-4 font-sans text-lg font-semibold">1. Your style</h2>
              <div className="space-y-5">
                {groups.map((g) =>
                  g.type === 'choose_one' ? (
                    <ChoiceGroup
                      key={g.name}
                      label={g.name}
                      name={`group-${g.name}`}
                      value={effectiveChoices[g.name]}
                      onChange={(id) => {
                        setChoices({ ...choices, [g.name]: id })
                        setSlot(null)
                      }}
                      options={g.options.map((o) => ({
                        value: o.id,
                        label: `${o.name}${o.price_delta_cents ? ` (${o.price_delta_cents > 0 ? '+' : '−'}${formatMoney(Math.abs(o.price_delta_cents))})` : ''}`,
                      }))}
                    />
                  ) : (
                    <fieldset key={g.name}>
                      <legend className="label">{g.name}</legend>
                      <div className="flex flex-wrap gap-2">
                        {g.options.map((o) => {
                          const on = addons.includes(o.id)
                          return (
                            <label key={o.id} className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${on ? 'border-brown-deep bg-brown-deep text-cream' : 'border-sand bg-paper hover:border-brown'}`}>
                              <input type="checkbox" className="sr-only" checked={on}
                                onChange={(e) => {
                                  setAddons(e.target.checked ? [...addons, o.id] : addons.filter((x) => x !== o.id))
                                  setSlot(null)
                                }} />
                              {o.name}
                              {o.price_delta_cents !== 0 && ` (${o.price_delta_cents > 0 ? '+' : '−'}${formatMoney(Math.abs(o.price_delta_cents))})`}
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>
                  ),
                )}
              </div>
            </section>
          )}

          {/* 2. Location */}
          <section aria-labelledby="step-location">
            <h2 id="step-location" className="mb-4 font-sans text-lg font-semibold">{groups.length ? '2' : '1'}. Where</h2>
            <ChoiceGroup
              name="location"
              value={loc}
              onChange={setLocationType}
              options={service.location_types.map((l) => ({ value: l, label: LOCATION_LABELS[l] }))}
            />
            {loc === 'salon' && sp.salons && (
              <p className="mt-3 text-sm text-stone">{sp.salons.name}, {sp.salons.address_line}, {sp.salons.city}</p>
            )}
            {loc === 'stylist_studio' && (
              <p className="mt-3 text-sm text-stone">The studio address is shared once your booking is confirmed.</p>
            )}
            {needsAddress && (
              <div className="mt-4 space-y-2">
                {addresses.data.length === 0 && <p className="text-sm text-stone">Add the address where you’d like your appointment.</p>}
                {addresses.data.map((a) => (
                  <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 ${address?.id === a.id ? 'border-brown bg-brown-soft' : 'border-sand bg-paper'}`}>
                    <input type="radio" name="address" className="mt-1 accent-[var(--color-brown-deep)]" checked={address?.id === a.id} onChange={() => setAddressId(a.id)} />
                    <span className="text-sm">
                      <span className="font-medium">{a.label}</span>
                      <span className="block text-stone">{[a.line1, a.city, a.postal_code].filter(Boolean).join(', ')}</span>
                    </span>
                  </label>
                ))}
                <Button variant="secondary" size="sm" onClick={() => setAddingAddress(true)}>
                  Add an address
                </Button>
                <p className="text-xs text-stone">Your address is shared with the stylist only after they confirm.</p>
              </div>
            )}
          </section>

          {/* 3. Time */}
          <section aria-labelledby="step-time">
            <h2 id="step-time" className="mb-1 font-sans text-lg font-semibold">{groups.length ? '3' : '2'}. When</h2>
            <p className="mb-4 text-sm text-stone">
              Takes about {formatDuration(q?.duration_minutes || service.duration_minutes)}. Times are shown in your time zone.
            </p>
            <SlotPicker serviceId={serviceId} optionIds={optionIds} stylistTimeZone={sp.timezone} value={slot} onChange={setSlot} />
          </section>

          {/* 4. Details */}
          <section aria-labelledby="step-details" className="space-y-4">
            <h2 id="step-details" className="font-sans text-lg font-semibold">{groups.length ? '4' : '3'}. Details</h2>
            <TextArea label="Notes for your stylist (optional)" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Hair length now, colour of extensions, inspiration photos you’ll send by message…" />
            <Input label="Phone for the day of the appointment (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {availableProviders.length > 1 && (
              <ChoiceGroup label="How would you like to pay?" name="provider" value={chosenProvider} onChange={setProvider}
                options={availableProviders.map((p) => ({ value: p, label: PAYMENT_PROVIDER_LABELS[p] }))} />
            )}
            {chosenProvider === 'pay_in_person' && <p className="text-sm text-stone">You’ll pay the stylist directly at the appointment.</p>}
            {chosenProvider === 'manual_etransfer' && (
              <p className="text-sm text-stone">After booking you’ll see where to send the e-Transfer. Your booking is held while our team verifies the payment.</p>
            )}
          </section>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <Avatar src={sp.avatar_url} name={sp.display_name} size="sm" />
              <div>
                <p className="font-medium">{sp.display_name}</p>
                <p className="text-sm text-stone">{service.title}</p>
              </div>
            </div>
            <div className="mt-4 border-t border-sand pt-4 text-sm">
              <p className="text-stone">When</p>
              <p className="font-medium">{slot ? formatDateTime(slot) : 'Choose a time'}</p>
              <p className="mt-2 text-stone">Where</p>
              <p className="font-medium">{LOCATION_LABELS[loc]}</p>
            </div>
            <div className="mt-4 border-t border-sand pt-4">
              {quote.loading && !q ? (
                <LoadingState label="Calculating price…" className="py-4" />
              ) : quote.error ? (
                <FormError error={friendlyError(quote.error)} />
              ) : q ? (
                <PriceBreakdown
                  items={q.line_items}
                  total={q.total_cents}
                  currency={q.currency}
                  deposit={chosenProvider === 'pay_in_person' ? null : q.deposit_cents}
                  balance={chosenProvider === 'pay_in_person' ? 0 : q.balance_cents}
                />
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <input className="control py-2 text-sm" placeholder="Promo code" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} aria-label="Promo code" />
              <Button variant="secondary" size="sm" onClick={() => setPromo(promoInput.trim())}>Apply</Button>
            </div>
            {promo && !quote.error && q?.discount_cents > 0 && <p className="mt-2 text-sm text-success">Promo applied.</p>}
            {promo && quote.error && (
              <button className="mt-2 text-sm underline" onClick={() => { setPromo(''); setPromoInput('') }}>Remove promo code</button>
            )}
            {q?.requires_approval && <p className="mt-4 text-sm text-stone">This stylist confirms requests personally. You’ll be notified when they accept.</p>}
            <div className="mt-4">
              <FormError error={submitError} />
            </div>
            <Button variant="accent" size="lg" className="mt-4 w-full" disabled={!canSubmit} loading={submitting} onClick={submit}>
              {chosenProvider === 'stripe' && q?.deposit_cents > 0
                ? `Continue to payment`
                : q?.requires_approval
                  ? 'Send booking request'
                  : 'Confirm booking'}
            </Button>
            {!slot && <p className="mt-2 text-center text-xs text-stone">Choose a time to continue.</p>}
            <p className="mt-3 text-center text-xs text-stone">
              By booking you agree to the <Link to="/cancellation-policy" className="underline" target="_blank">cancellation policy</Link>.
            </p>
          </div>
        </aside>
      </div>

      <Modal open={addingAddress} onClose={() => setAddingAddress(false)} title="Add an address">
        <AddressForm
          onCancel={() => setAddingAddress(false)}
          onSave={async (row) => {
            const created = unwrap(await supabase.from('addresses').insert({ ...row, user_id: user.id }).select().single())
            await addresses.reload()
            setAddressId(created.id)
            setAddingAddress(false)
          }}
        />
      </Modal>
    </div>
  )
}
