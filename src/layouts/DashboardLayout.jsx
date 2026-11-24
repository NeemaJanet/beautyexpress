import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useUnreadCounts } from '../hooks/useUnreadCounts.js'
import { Footer } from '../components/navigation/Footer.jsx'
import { Navbar } from '../components/navigation/Navbar.jsx'
import { SuspendedBanner } from './SuspendedBanner.jsx'

const NAVS = {
  client: [
    ['/client/dashboard', 'Overview'],
    ['/client/bookings', 'Bookings'],
    ['/messages', 'Messages', 'messages'],
    ['/client/favorites', 'Favourites'],
    ['/client/reviews', 'Reviews'],
    ['/client/payments', 'Payments'],
    ['/client/addresses', 'Addresses'],
    ['/notifications', 'Notifications', 'notifications'],
    ['/client/profile', 'Profile'],
    ['/client/support', 'Help and support'],
  ],
  stylist: [
    ['/stylist/dashboard', 'Overview'],
    ['/stylist/bookings', 'Appointments'],
    ['/messages', 'Messages', 'messages'],
    ['/stylist/services', 'Services and prices'],
    ['/stylist/availability', 'Availability'],
    ['/stylist/profile', 'Public profile'],
    ['/stylist/portfolio', 'Portfolio'],
    ['/stylist/earnings', 'Earnings and payouts'],
    ['/notifications', 'Notifications', 'notifications'],
    ['/stylist/settings', 'Settings'],
    ['/client/support', 'Help and support'],
  ],
  admin: [
    ['/admin', 'Overview', null, true],
    ['/admin/users', 'Users'],
    ['/admin/stylists', 'Stylists'],
    ['/admin/bookings', 'Bookings'],
    ['/admin/transactions', 'Transactions'],
    ['/admin/reports', 'Reports and disputes'],
    ['/admin/categories', 'Categories'],
    ['/admin/settings', 'Platform settings'],
    ['/admin/audit', 'Audit log'],
  ],
}

/**
 * Layout for signed-in areas. `area` picks the side navigation; when omitted
 * (shared pages like Messages) it follows the person's main role.
 */
export function DashboardLayout({ area }) {
  const { isAdmin, isStylist } = useAuth()
  const counts = useUnreadCounts()
  const nav = NAVS[area || (isStylist ? 'stylist' : 'client')]

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <SuspendedBanner />
      <div className="container-page flex-1 py-6 lg:grid lg:grid-cols-[220px_1fr] lg:gap-10 lg:py-10">
        <aside className="no-print mb-6 lg:mb-0">
          <nav aria-label="Dashboard" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:px-0">
            {nav.map(([to, label, badge, end]) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center justify-between whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors lg:rounded-[var(--radius-control)] ${
                    isActive ? 'bg-brown-deep text-cream' : 'text-ink-soft hover:bg-sand-soft'
                  }`
                }
              >
                {label}
                {badge && counts[badge] > 0 && (
                  <span className="ml-2 rounded-full bg-fuchsia px-1.5 text-xs text-white">{counts[badge]}</span>
                )}
              </NavLink>
            ))}
            {isAdmin && area !== 'admin' && (
              <NavLink to="/admin" className="whitespace-nowrap rounded-full px-4 py-2 text-sm text-fuchsia-deep hover:bg-sand-soft lg:mt-4 lg:rounded-[var(--radius-control)]">
                Admin console
              </NavLink>
            )}
            {isStylist && area === 'client' && (
              <NavLink to="/stylist/dashboard" className="whitespace-nowrap rounded-full px-4 py-2 text-sm text-fuchsia-deep hover:bg-sand-soft lg:mt-4 lg:rounded-[var(--radius-control)]">
                Stylist dashboard
              </NavLink>
            )}
            {isStylist && area === 'stylist' && (
              <NavLink to="/client/bookings" className="whitespace-nowrap rounded-full px-4 py-2 text-sm text-fuchsia-deep hover:bg-sand-soft lg:mt-4 lg:rounded-[var(--radius-control)]">
                My bookings as a client
              </NavLink>
            )}
          </nav>
        </aside>
        <main id="main" className="min-w-0">
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  )
}
