import { Outlet } from 'react-router-dom'
import { Footer } from '../components/navigation/Footer.jsx'
import { Navbar } from '../components/navigation/Navbar.jsx'
import { SuspendedBanner } from './SuspendedBanner.jsx'

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-paper focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Navbar />
      <SuspendedBanner />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
