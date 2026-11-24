import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, ChoiceGroup } from '../../components/common/Field.jsx'
import { ConfirmDialog } from '../../components/common/Modal.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { friendlyError } from '../../lib/validation.js'
import { updateProfile } from '../../services/authService.js'
import { updateStylistProfile } from '../../services/stylistService.js'

export default function StylistSettingsPage() {
  useDocumentTitle('Settings')
  const { user, profile, stylistProfile: sp, refresh } = useAuth()
  const toast = useToast()
  const [unpublishing, setUnpublishing] = useState(false)

  const saveStylist = async (fields, msg) => {
    try {
      await updateStylistProfile(user.id, fields)
      await refresh()
      toast.success(msg)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }
  const saveProfile = async (fields) => {
    try {
      await updateProfile(user.id, fields)
      await refresh()
      toast.success('Notification settings saved')
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" />
      <section className="panel space-y-5 p-6">
        <SectionTitle>Bookings</SectionTitle>
        <Checkbox label="Accept new bookings" hint="Turn off while you are away or fully booked. Your profile stays visible."
          checked={sp.is_accepting_bookings} onChange={(e) => saveStylist({ is_accepting_bookings: e.target.checked }, e.target.checked ? 'Taking bookings' : 'Bookings paused')} />
        <ChoiceGroup label="Default booking style" name="booking-mode" value={sp.booking_mode}
          onChange={(m) => saveStylist({ booking_mode: m }, 'Booking style saved')}
          options={[{ value: 'approval', label: 'I approve each request' }, { value: 'instant', label: 'Instant booking' }]} />
        <p className="text-sm text-stone">Individual services can override this. Hours, notice and breaks are on the <Link to="/stylist/availability" className="link">Availability</Link> page.</p>
      </section>

      <section className="panel space-y-4 p-6">
        <SectionTitle>Notifications</SectionTitle>
        <Checkbox label="Email me new requests, cancellations and reminders" checked={profile.email_opt_in} onChange={(e) => saveProfile({ email_opt_in: e.target.checked })} />
        <Checkbox label="Text me new requests and cancellations" hint={profile.phone ? undefined : 'Add a mobile number in your account profile first.'}
          disabled={!profile.phone} checked={profile.sms_opt_in} onChange={(e) => saveProfile({ sms_opt_in: e.target.checked })} />
      </section>

      <section className="panel space-y-4 p-6">
        <SectionTitle>Account</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" to="/client/profile">Email, password and phone</Button>
          <Button variant="secondary" to="/stylist/earnings">Payout account</Button>
        </div>
        <div className="border-t border-sand pt-4">
          <p className="text-sm text-stone">Hide your profile from search entirely. You can publish it again from the setup steps.</p>
          <Button variant="danger-outline" className="mt-3" onClick={() => setUnpublishing(true)} disabled={!sp.onboarding_completed}>Unpublish my profile</Button>
        </div>
      </section>

      <ConfirmDialog open={unpublishing} onClose={() => setUnpublishing(false)} tone="danger" title="Unpublish your profile?" confirmLabel="Unpublish"
        onConfirm={async () => {
          await saveStylist({ onboarding_completed: false }, 'Profile unpublished')
          setUnpublishing(false)
        }}>
        Clients won’t find you or be able to book. Existing bookings stay as they are.
      </ConfirmDialog>
    </div>
  )
}
