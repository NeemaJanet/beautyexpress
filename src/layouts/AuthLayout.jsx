import { Outlet } from 'react-router-dom'
import { Logo } from '../components/navigation/Logo.jsx'

/** Centered, distraction-free layout for sign-in, sign-up and onboarding. */
export function AuthLayout() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="container-page flex h-16 items-center">
        <Logo />
      </header>
      <main id="main" className="container-page flex justify-center pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  )
}
