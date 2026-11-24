const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')

export function Avatar({ src, name, size = 'md', className = '' }) {
  const sizes = { xs: 'h-7 w-7 text-xs', sm: 'h-9 w-9 text-sm', md: 'h-12 w-12 text-base', lg: 'h-20 w-20 text-2xl', xl: 'h-28 w-28 text-3xl' }
  if (src) {
    return <img src={src} alt="" className={`${sizes[size]} shrink-0 rounded-full border border-sand object-cover ${className}`} />
  }
  return (
    <span
      aria-hidden="true"
      className={`${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-fuchsia-soft font-display text-fuchsia-deep ${className}`}
    >
      {initials(name)}
    </span>
  )
}
