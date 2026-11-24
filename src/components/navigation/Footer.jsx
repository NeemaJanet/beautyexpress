import { Link } from 'react-router-dom'
import { brand } from '../../config/brand.js'
import { Logo } from './Logo.jsx'

export function Footer() {
  return (
    <footer className="no-print mt-24 border-t border-sand bg-sand-soft/50">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-stone">{brand.tagline}</p>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Clients</h2>
          <ul className="mt-3 space-y-2 text-sm text-stone">
            <li><Link className="hover:text-ink" to="/explore">Find a stylist</Link></li>
            <li><Link className="hover:text-ink" to="/categories">Browse styles</Link></li>
            <li><Link className="hover:text-ink" to="/cancellation-policy">Cancellations and refunds</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Stylists</h2>
          <ul className="mt-3 space-y-2 text-sm text-stone">
            <li><Link className="hover:text-ink" to="/sign-up?role=stylist">Join as a stylist</Link></li>
            <li><Link className="hover:text-ink" to="/about">How BeautyExpress works</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-stone">
            <li><Link className="hover:text-ink" to="/contact">Contact</Link></li>
            <li><Link className="hover:text-ink" to="/terms">Terms of service</Link></li>
            <li><Link className="hover:text-ink" to="/privacy">Privacy policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-sand">
        <p className="container-page py-5 text-xs text-stone">
          © {new Date().getFullYear()} {brand.legalName}. Made in {brand.country}.
        </p>
      </div>
    </footer>
  )
}
