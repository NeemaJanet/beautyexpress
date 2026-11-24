import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, ChoiceGroup, FormError, Input } from '../../components/common/Field.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { email, maxLength, required, validate, validatePassword } from '../../lib/validation.js'
import { signUp } from '../../services/authService.js'
import { safeNext } from '../../utils/navigation.js'

export default function SignUpPage() {
  useDocumentTitle('Create an account')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [v, setV] = useState({
    fullName: '',
    email: '',
    password: '',
    role: params.get('role') === 'stylist' ? 'stylist' : 'client',
    agree: false,
  })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(v, {
      fullName: [required('Enter your name.'), maxLength(120)],
      email: [required('Enter your email.'), email()],
      password: [required('Choose a password.'), (p) => validatePassword(p)],
      agree: [(a) => (a ? null : 'Please accept the terms to continue.')],
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const result = await signUp(v)
      if (result.session) navigate(next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding', { replace: true })
      else setCheckEmail(true) // email confirmation is switched on
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (checkEmail) {
    return (
      <div className="w-full max-w-md text-center">
        <h1 className="text-4xl">Check your email</h1>
        <p className="mt-4 text-ink-soft">
          We sent a confirmation link to <strong>{v.email}</strong>. Open it to finish creating your account.
        </p>
        <p className="mt-6 text-sm text-stone">
          Already confirmed? <Link to="/sign-in" className="link">Sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="text-4xl">{v.role === 'stylist' ? 'Start taking bookings' : 'Create your account'}</h1>
      <p className="mt-2 text-stone">
        {v.role === 'stylist' ? 'Set up your profile, services and hours in a few minutes.' : 'Book stylists, track appointments and message in one place.'}
      </p>
      <form onSubmit={submit} className="panel mt-8 space-y-4 p-6" noValidate>
        <FormError error={error} />
        <ChoiceGroup
          label="I want to"
          name="role"
          value={v.role}
          onChange={(role) => setV({ ...v, role })}
          options={[
            { value: 'client', label: 'Book appointments' },
            { value: 'stylist', label: 'Offer my services' },
          ]}
        />
        <Input label="Full name" autoComplete="name" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} error={errors.fullName} required />
        <Input label="Email" type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} required />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
          error={errors.password}
          hint="At least 8 characters, with letters and a number."
          required
        />
        <div>
          <Checkbox
            checked={v.agree}
            onChange={(e) => setV({ ...v, agree: e.target.checked })}
            label={
              <>
                I agree to the <Link to="/terms" className="link" target="_blank">terms</Link> and{' '}
                <Link to="/privacy" className="link" target="_blank">privacy policy</Link>
              </>
            }
          />
          {errors.agree && <p className="mt-1 text-sm text-danger">{errors.agree}</p>}
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-stone">
        Already have an account? <Link to="/sign-in" className="link">Sign in</Link>
      </p>
    </div>
  )
}
