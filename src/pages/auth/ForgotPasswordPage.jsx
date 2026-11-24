import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { FormError, Input } from '../../components/common/Field.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { isEmail } from '../../lib/validation.js'
import { sendPasswordReset } from '../../services/authService.js'

export default function ForgotPasswordPage() {
  useDocumentTitle('Reset your password')
  const [emailValue, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!isEmail(emailValue)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await sendPasswordReset(emailValue)
      setSent(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-4xl">Reset your password</h1>
      {sent ? (
        <div className="panel mt-8 p-6">
          <p>
            If an account exists for <strong>{emailValue}</strong>, we have emailed a link to choose a new password. The
            link works once and expires after an hour.
          </p>
          <Link to="/sign-in" className="link mt-4 inline-block">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="panel mt-8 space-y-4 p-6" noValidate>
          <p className="text-stone">Enter your account email and we’ll send you a reset link.</p>
          <FormError error={error} />
          <Input label="Email" type="email" autoComplete="email" value={emailValue} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
          <p className="text-center text-sm">
            <Link to="/sign-in" className="link">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  )
}
