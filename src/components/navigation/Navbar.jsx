import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { homePathFor, useAuth } from '../../contexts/AuthContext.jsx'
import { useUnreadCounts } from '../../hooks/useUnreadCounts.js'
import { Avatar } from '../common/Avatar.jsx'
import { Button } from '../common/Button.jsx'
import { Logo } from './Logo.jsx'

const navLinkClass = ({ isActive }) =>
  `rounded-full px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-ink' : 'text-stone hover:text-ink'}`

function CountDot({ n }) {
  if (!n) return null
  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-fuchsia px-1.5 text-xs font-semibold text-white">
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function Navbar() {
  const auth = useAuth()
  const { user, profile, stylistProfile, signOut } = auth
  const counts = useUnreadCounts()
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const accountRef = useRef(null)

  // Close menus when the page changes (adjusting state during render, per React docs).
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMenuOpen(false)
    setAccountOpen(false)
  }

  useEffect(() => {
    const onClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  const dashboard = user ? homePathFor(auth) : '/sign-in'
  const name = stylistProfile?.display_name || profile?.full_name || user?.email

  return (
    <header className="no-print sticky top-0 z-40 border-b border-sand/80 bg-cream/90 backdrop-blur">
      <nav className="container-page flex h-16 items-center justify-between gap-4" aria-label="Main">
        <div className="flex items-center gap-6">
          <Logo />
          <div className="hidden items-center gap-1 md:flex">
            <NavLink to="/explore" className={navLinkClass}>
              Find a stylist
            </NavLink>
            <NavLink to="/categories" className={navLinkClass}>
              Styles
            </NavLink>
            {!auth.isStylist && (
              <NavLink to="/sign-up?role=stylist" className={navLinkClass}>
                For stylists
              </NavLink>
            )}
          </div>
        </div>

        <div className="hidden items-center gap-1 md:flex">
          {user ? (
            <>
              <NavLink to="/messages" className={navLinkClass}>
                Messages
                <CountDot n={counts.messages} />
              </NavLink>
              <NavLink to="/notifications" className={navLinkClass}>
                Notifications
                <CountDot n={counts.notifications} />
              </NavLink>
              <div className="relative ml-2" ref={accountRef}>
                <button
                  onClick={() => setAccountOpen((o) => !o)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-full border border-sand bg-paper py-1 pl-1 pr-3 text-sm hover:border-brown"
                >
                  <Avatar src={stylistProfile?.avatar_url || profile?.avatar_url} name={name} size="xs" />
                  <span className="max-w-32 truncate">{name?.split(' ')[0] || 'Account'}</span>
                </button>
                {accountOpen && (
                  <div role="menu" className="absolute right-0 mt-2 w-56 overflow-hidden rounded-[var(--radius-panel)] border border-sand bg-paper py-1 shadow-xl">
                    <Link role="menuitem" to={dashboard} className="block px-4 py-2 text-sm hover:bg-sand-soft">
                      Dashboard
                    </Link>
                    {auth.isStylist && (
                      <Link role="menuitem" to="/stylist/bookings" className="block px-4 py-2 text-sm hover:bg-sand-soft">
                        Appointments
                      </Link>
                    )}
                    <Link role="menuitem" to="/client/bookings" className="block px-4 py-2 text-sm hover:bg-sand-soft">
                      My bookings
                    </Link>
                    <Link role="menuitem" to="/client/profile" className="block px-4 py-2 text-sm hover:bg-sand-soft">
                      Profile and settings
                    </Link>
                    {auth.isAdmin && (
                      <Link role="menuitem" to="/admin" className="block px-4 py-2 text-sm hover:bg-sand-soft">
                        Admin
                      </Link>
                    )}
                    <button role="menuitem" onClick={handleSignOut} className="block w-full border-t border-sand px-4 py-2 text-left text-sm hover:bg-sand-soft">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <NavLink to="/sign-in" className={navLinkClass}>
                Sign in
              </NavLink>
              <Button to="/sign-up" size="sm" className="ml-2">
                Create account
              </Button>
            </>
          )}
        </div>

        <button
          className="relative rounded-full p-2 md:hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {counts.messages + counts.notifications > 0 && !menuOpen && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-fuchsia" aria-hidden="true" />
          )}
        </button>
      </nav>

      {menuOpen && (
        <div id="mobile-menu" className="border-t border-sand bg-cream md:hidden">
          <div className="container-page flex flex-col py-3">
            {[
              ['/explore', 'Find a stylist'],
              ['/categories', 'Styles'],
              ...(user
                ? [
                    [dashboard, 'Dashboard'],
                    ['/messages', `Messages${counts.messages ? ` (${counts.messages})` : ''}`],
                    ['/notifications', `Notifications${counts.notifications ? ` (${counts.notifications})` : ''}`],
                    ['/client/bookings', 'My bookings'],
                    ['/client/profile', 'Profile and settings'],
                    ...(auth.isAdmin ? [['/admin', 'Admin']] : []),
                  ]
                : [
                    ['/sign-up?role=stylist', 'For stylists'],
                    ['/sign-in', 'Sign in'],
                    ['/sign-up', 'Create account'],
                  ]),
            ].map(([to, label]) => (
              <Link key={to + label} to={to} className="rounded-lg px-2 py-3 text-base hover:bg-sand-soft">
                {label}
              </Link>
            ))}
            {user && (
              <button onClick={handleSignOut} className="rounded-lg px-2 py-3 text-left text-base hover:bg-sand-soft">
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
