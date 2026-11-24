export function PageHeader({ title, description, actions, className = '' }) {
  return (
    <div className={`mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div>
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-stone">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** Section heading inside a page. */
export function SectionTitle({ children, action, className = '' }) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-4 ${className}`}>
      <h2 className="font-sans text-lg font-semibold">{children}</h2>
      {action}
    </div>
  )
}
