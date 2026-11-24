import { friendlyError } from '../../lib/validation.js'

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function LoadingState({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 py-16 text-stone ${className}`}>
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children, action, className = '' }) {
  return (
    <div className={`rounded-[var(--radius-panel)] border border-dashed border-sand px-6 py-12 text-center ${className}`}>
      <h3 className="font-sans text-lg font-semibold">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-md text-stone">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className = '' }) {
  return (
    <div role="alert" className={`rounded-[var(--radius-panel)] border border-danger/30 bg-danger-soft px-6 py-8 text-center ${className}`}>
      <p className="font-medium text-danger">{friendlyError(error) || 'Something went wrong.'}</p>
      {onRetry && (
        <button onClick={onRetry} className="link mt-3 text-danger">
          Try again
        </button>
      )}
    </div>
  )
}

/** Renders loading / error / empty / content in one place. */
export function AsyncBoundary({ loading, error, onRetry, isEmpty, empty, children }) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (isEmpty) return empty
  return children
}
