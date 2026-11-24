import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { FormError, Input } from '../../components/common/Field.jsx'
import { LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { validatePassword } from '../../lib/validation.js'
import { updatePassword } from '../../services/authService.js'

/** The link in the reset email signs the person in temporarily and lands here. */
export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password')
  const { user, loading, setRecoveryMode } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <LoadingState />
  if (!user) {
    return (
      <div className="w-full max-w-md text-center">
        <h1 className="text-3xl">This reset link has expired</h1>
        <p className="mt-3 text-stone">Reset links work once and only for a limited time.</p>
        <Button to="/forgot-password" className="mt-6">
          Send a new link
        </Button>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    const err = validatePassword(pw) || (pw !== pw2 ? 'The passwords do not match.' : null)
    if (err) {
      setError(err)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updatePassword(pw)
      setRecoveryMode(false)
      toast.success('Password updated')
      navigate('/onboarding?continue=1', { replace: true })
    } catch (e2) {
      setError(e2)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-4xl">Choose a new password</h1>
      <form onSubmit={submit} className="panel mt-8 space-y-4 p-6" noValidate>
        <FormError error={error} />
        <Input label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 8 characters, with letters and a number." />
        <Input label="Repeat new password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy}>
          Save password
        </Button>
        <p className="text-center text-sm">
          <Link to="/" className="link">
            Cancel
          </Link>
        </p>
      </form>
    </div>
  )
}
