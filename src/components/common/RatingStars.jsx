/** Read-only star rating, or an input when `onChange` is given. */
export function RatingStars({ value = 0, count, onChange, size = 'sm' }) {
  const px = size === 'lg' ? 'h-8 w-8' : 'h-4 w-4'
  if (onChange) {
    return (
      <div role="radiogroup" aria-label="Rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => onChange(n)}
            className="rounded p-0.5"
          >
            <Star filled={n <= value} className={px} />
          </button>
        ))}
      </div>
    )
  }
  const rounded = Math.round(Number(value) * 2) / 2
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" aria-label={`Rated ${Number(value).toFixed(1)} out of 5`}>
      <span className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} filled={n <= rounded} half={n - 0.5 === rounded} className={px} />
        ))}
      </span>
      {count !== undefined && (
        <span className="text-stone">
          {Number(value) > 0 ? Number(value).toFixed(1) : 'New'}
          {count > 0 && ` (${count})`}
        </span>
      )}
    </span>
  )
}

function Star({ filled, half, className }) {
  return (
    <svg viewBox="0 0 20 20" className={`${className} ${filled || half ? 'text-fuchsia' : 'text-sand'}`} aria-hidden="true">
      <defs>
        <linearGradient id="half-star">
          <stop offset="50%" stopColor="currentColor" />
          <stop offset="50%" stopColor="var(--color-sand)" />
        </linearGradient>
      </defs>
      <path
        fill={half ? 'url(#half-star)' : 'currentColor'}
        d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z"
      />
    </svg>
  )
}
