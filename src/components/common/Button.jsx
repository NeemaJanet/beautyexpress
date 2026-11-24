import { Link } from 'react-router-dom'
import { Spinner } from './States.jsx'

const variants = {
  primary: 'bg-brown-deep text-cream hover:bg-brown',
  accent: 'bg-fuchsia text-white hover:bg-fuchsia-deep',
  secondary: 'border border-sand bg-paper text-ink hover:border-brown hover:bg-sand-soft',
  ghost: 'text-ink-soft hover:bg-sand-soft hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110',
  'danger-outline': 'border border-danger/40 bg-paper text-danger hover:bg-danger-soft',
}

const sizes = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-[0.95rem]',
  lg: 'px-6 py-3 text-base',
}

/**
 * One button for the whole app.
 * - `to` renders a router link, `href` an external link, otherwise a <button>.
 * - `loading` disables the button and shows a spinner.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  to,
  href,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors
    disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${sizes[size]} ${className}`
  const content = (
    <>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    )
  }
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  )
}
