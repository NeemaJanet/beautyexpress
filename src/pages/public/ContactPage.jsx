import { useState } from 'react'
import { Button } from '../../components/common/Button.jsx'
import { FormError, Input, Select, TextArea } from '../../components/common/Field.jsx'
import { brand } from '../../config/brand.js'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { getPublicSettings } from '../../services/catalogService.js'
import { createReport } from '../../services/supportService.js'

/**
 * Signed-in people send a support request that admins answer in the app.
 * Visitors who are signed out get the support email address instead
 * (this avoids an open, spammable form).
 */
export default function ContactPage() {
  useDocumentTitle('Contact')
  const { user } = useAuth()
  const toast = useToast()
  const settings = useAsync(getPublicSettings, [])
  const supportEmail = settings.data?.support_email || brand.supportEmail
  const [form, setForm] = useState({ category: 'support', subject: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (form.subject.trim().length < 3 || form.description.trim().length < 10) {
      setError('Please add a subject and at least a sentence describing what you need.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createReport({ reporter_id: user.id, category: form.category, subject: form.subject.trim(), description: form.description.trim() })
      setSent(true)
      toast.success('Message sent')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-page grid gap-12 py-14 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <h1 className="text-4xl">Contact us</h1>
        <p className="mt-4 max-w-md text-ink-soft">
          Questions about a booking, a payment or your account? Send us a message and the team will reply in your
          support inbox.
        </p>
        <p className="mt-6 text-sm text-stone">
          Email:{' '}
          <a className="link" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
        </p>
        <p className="mt-2 text-sm text-stone">For an urgent safety issue, contact local emergency services first.</p>
      </div>

      <div className="panel p-6">
        {!user ? (
          <div>
            <h2 className="font-sans text-lg font-semibold">Sign in to send a message</h2>
            <p className="mt-2 text-stone">So we can link your message to your bookings, please sign in. Or email us directly.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button to="/sign-in?next=/contact">Sign in</Button>
              <Button href={`mailto:${supportEmail}`} variant="secondary">
                Email support
              </Button>
            </div>
          </div>
        ) : sent ? (
          <div>
            <h2 className="font-sans text-lg font-semibold">Thanks, we have your message</h2>
            <p className="mt-2 text-stone">You can follow replies under Help and support.</p>
            <Button to="/client/support" className="mt-5">
              Open my support requests
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <FormError error={error} />
            <Select
              label="Topic"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              options={[
                { value: 'support', label: 'General question' },
                { value: 'payment', label: 'Payment or refund' },
                { value: 'account', label: 'My account' },
                { value: 'quality', label: 'Service quality' },
                { value: 'safety', label: 'Safety concern' },
                { value: 'other', label: 'Something else' },
              ]}
            />
            <Input label="Subject" value={form.subject} maxLength={150} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <TextArea label="Message" rows={6} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            <Button type="submit" loading={busy}>
              Send message
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
