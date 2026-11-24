import { useState } from 'react'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, FormError, Input, Select } from '../../components/common/Field.jsx'
import { ImageUpload } from '../../components/common/ImageUpload.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { LocationPicker } from '../../components/forms/LocationPicker.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { TIMEZONES } from '../../lib/availability.js'
import { isEmail, isPhone, validatePassword } from '../../lib/validation.js'
import { updateEmail, updatePassword, updateProfile } from '../../services/authService.js'

export default function ProfilePage() {
  useDocumentTitle('Profile')
  const { user, profile, refresh } = useAuth()
  const toast = useToast()
  const [v, setV] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
    timezone: profile.timezone || 'America/Halifax',
    email_opt_in: profile.email_opt_in,
    sms_opt_in: profile.sms_opt_in,
  })
  const [loc, setLoc] = useState(profile.preferred_lat ? { label: profile.preferred_city, lat: profile.preferred_lat, lng: profile.preferred_lng } : null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [pw, setPw] = useState('')
  const [accountMsg, setAccountMsg] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    if (!v.full_name.trim()) return setError('Your name is required.')
    if (v.phone && !isPhone(v.phone)) return setError('Enter a valid phone number.')
    if (v.sms_opt_in && !v.phone) return setError('Add a phone number to receive text messages.')
    setBusy(true)
    setError(null)
    try {
      await updateProfile(user.id, {
        full_name: v.full_name.trim(),
        phone: v.phone.trim() || null,
        timezone: v.timezone,
        email_opt_in: v.email_opt_in,
        sms_opt_in: v.sms_opt_in,
        preferred_city: loc?.label || null,
        preferred_lat: loc?.lat ?? null,
        preferred_lng: loc?.lng ?? null,
      })
      await refresh()
      toast.success('Profile saved')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const changeEmail = async () => {
    if (!isEmail(newEmail)) return setAccountMsg({ error: 'Enter a valid email.' })
    try {
      await updateEmail(newEmail)
      setAccountMsg({ ok: 'Check both your old and new inbox to confirm the change.' })
      setNewEmail('')
    } catch (err) {
      setAccountMsg({ error: err.message })
    }
  }

  const changePassword = async () => {
    const err = validatePassword(pw)
    if (err) return setAccountMsg({ error: err })
    try {
      await updatePassword(pw)
      setPw('')
      setAccountMsg({ ok: 'Password updated.' })
    } catch (e) {
      setAccountMsg({ error: e.message })
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Profile and settings" />
      <form onSubmit={save} className="panel space-y-5 p-6">
        <div className="flex items-center gap-4">
          <Avatar src={profile.avatar_url} name={profile.full_name} size="lg" />
          <ImageUpload bucket="avatars" userId={user.id} label="Change photo"
            onUploaded={async ({ url }) => {
              await updateProfile(user.id, { avatar_url: url })
              await refresh()
              toast.success('Photo updated')
            }} />
        </div>
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required />
          <Input label="Mobile number" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <Select label="Time zone" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}
          options={TIMEZONES.map((t) => ({ value: t, label: t.replace('America/', '').replace('_', ' ') }))} hint="Used for times in emails and reminders." />
        <div>
          <span className="label">Default search location</span>
          <LocationPicker id="profile-location" value={loc} onChange={setLoc} />
        </div>
        <fieldset className="space-y-3">
          <legend className="label">Notifications</legend>
          <Checkbox label="Email me about bookings, messages and reminders" checked={v.email_opt_in} onChange={(e) => setV({ ...v, email_opt_in: e.target.checked })} />
          <Checkbox label="Text me important booking updates" hint="Standard message rates may apply. Only if SMS is enabled on this site." checked={v.sms_opt_in} onChange={(e) => setV({ ...v, sms_opt_in: e.target.checked })} />
        </fieldset>
        <Button type="submit" loading={busy}>Save profile</Button>
      </form>

      <section className="panel space-y-5 p-6">
        <h2 className="font-sans text-lg font-semibold">Sign-in details</h2>
        {accountMsg?.error && <FormError error={accountMsg.error} />}
        {accountMsg?.ok && <p className="text-sm text-success">{accountMsg.ok}</p>}
        <p className="text-sm text-stone">Current email: {user.email}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input className="flex-1" label="New email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <Button variant="secondary" onClick={changeEmail}>Change email</Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input className="flex-1" label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button variant="secondary" onClick={changePassword}>Change password</Button>
        </div>
        <p className="text-sm text-stone">
          To delete your account, contact support from Help and support. We keep booking and payment records as required by law.
        </p>
      </section>
    </div>
  )
}
