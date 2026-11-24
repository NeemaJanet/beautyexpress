/**
 * Route guards. These only control what the browser SHOWS — the database
 * enforces permissions on every request regardless.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { Button } from '../common/Button.jsx'
import { LoadingState } from '../common/States.jsx'

export function RequireAuth({ allowIncompleteOnboarding = false, children }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <LoadingState className="min-h-[50vh]" />
  if (!auth.user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/sign-in?next=${next}`} replace />
  }
  const needsOnboarding = auth.isStylist
    ? !auth.stylistProfile?.onboarding_completed && !auth.isAdmin
    : !auth.profile?.onboarding_completed && !auth.isAdmin
  if (needsOnboarding && !allowIncompleteOnboarding) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />
  }
  return children ?? <Outlet />
}

export function RequireRole({ role, children }) {
  const auth = useAuth()
  if (auth.loading) return <LoadingState className="min-h-[50vh]" />
  const ok = role === 'admin' ? auth.isAdmin : role === 'stylist' ? auth.isStylist : Boolean(auth.user)
  if (!ok) return <NotAuthorized role={role} />
  return children ?? <Outlet />
}

function NotAuthorized({ role }) {
  return (
    <div className="container-page py-24 text-center">
      <h1 className="text-3xl">This area is for {role === 'admin' ? 'administrators' : `${role}s`}</h1>
      <p className="mx-auto mt-3 max-w-md text-stone">
        {role === 'stylist'
          ? 'Want to offer your services? Create a stylist profile from your account.'
          : 'Your account does not have access to this page.'}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button to="/" variant="secondary">
          Go home
        </Button>
        {role === 'stylist' && <Button to="/onboarding?become=stylist">Become a stylist</Button>}
      </div>
    </div>
  )
}
