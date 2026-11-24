/** Simple tab bar. `tabs` = [{ value, label, count? }] */
export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div role="tablist" className={`mb-6 flex gap-1 overflow-x-auto border-b border-sand ${className}`}>
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active ? 'border-ink text-ink' : 'border-transparent text-stone hover:text-ink'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-2 rounded-full bg-fuchsia-soft px-2 py-0.5 text-xs text-fuchsia-deep">{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
