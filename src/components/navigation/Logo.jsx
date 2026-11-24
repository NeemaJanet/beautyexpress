import { Link } from 'react-router-dom'
import { brand } from '../../config/brand.js'

export function Logo({ className = '' }) {
  return (
    <Link to="/" className={`inline-flex items-baseline gap-0.5 font-display text-2xl font-semibold text-ink ${className}`}>
      {brand.name}
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-fuchsia" />
    </Link>
  )
}
