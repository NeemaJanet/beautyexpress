import { useId } from 'react'

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, hint, error, children, className = '', required }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const child = typeof children === 'function' ? children({ id, describedBy, invalid: Boolean(error) }) : children
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {child}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-stone">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ label, hint, error, className = '', required, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={`control ${invalid ? 'control-error' : ''}`}
          {...props}
        />
      )}
    </Field>
  )
}

export function TextArea({ label, hint, error, className = '', rows = 4, required, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={`control resize-y ${invalid ? 'control-error' : ''}`}
          {...props}
        />
      )}
    </Field>
  )
}

export function Select({ label, hint, error, className = '', options = [], placeholder, required, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={`control ${invalid ? 'control-error' : ''}`}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function Checkbox({ label, hint, className = '', ...props }) {
  const id = useId()
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 rounded border-sand accent-[var(--color-brown-deep)]"
        {...props}
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-stone">{hint}</span>}
      </label>
    </div>
  )
}

/** Segmented choice (radio group styled as pills). */
export function ChoiceGroup({ label, value, onChange, options, name, className = '' }) {
  return (
    <fieldset className={className}>
      {label && <legend className="label">{label}</legend>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o.value
          return (
            <label
              key={o.value}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-deep ${
                active ? 'border-brown-deep bg-brown-deep text-cream' : 'border-sand bg-paper text-ink-soft hover:border-brown'
              } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={o.value}
                checked={active}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Shows a form-level error from the server. */
export function FormError({ error }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {typeof error === 'string' ? error : error.message}
    </div>
  )
}
