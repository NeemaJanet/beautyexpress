import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { FormError, Input } from '../../components/common/Field.jsx'
import { homePathFor, useAuth } from '../../contexts/AuthContext.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { email, required, validate } from '../../lib/validation.js'
import { signIn } from '../../services/authService.js'
import { safeNext } from '../../utils/navigation.js'

export default function SignInPage() {
  useDocumentTitle('Sign in')
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [v, setV] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (auth.user && !auth.loading && !busy) return <Navigate to={next || homePathFor(auth)} replace />

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(v, { email: [required('Enter your email.'), email()], password: [required('Enter your password.')] })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      await signIn(v)
      navigate(next || '/onboarding?continue=1', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-4xl">Welcome back</h1>
      <p className="mt-2 text-stone">Sign in to manage your bookings.</p>
      <form onSubmit={submit} className="panel mt-8 space-y-4 p-6" noValidate>
        <FormError error={error} />
        <Input label="Email" type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} required />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
          error={errors.password}
          required
        />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="link">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-stone">
        New here?{' '}
        <Link to={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="link">
          Create an account
        </Link>
      </p>
    </div>
  )
}
