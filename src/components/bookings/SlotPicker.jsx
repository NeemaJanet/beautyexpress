import { useState } from 'react'
import { useAsync } from '../../hooks/useAsync.js'
import { dayChipLabel, formatTime, groupSlotsByPeriod, upcomingDays } from '../../lib/availability.js'
import { getSlots } from '../../services/bookingService.js'
import { ErrorState, LoadingState } from '../common/States.jsx'

/**
 * Pick a day, then a free start time. Free times come from the server
 * (get_available_slots), already excluding booked and blocked times.
 * Days are shown in the stylist's time zone; times in the viewer's.
 */
export function SlotPicker({ serviceId, optionIds, stylistTimeZone, value, onChange, excludeBookingId, days = 21 }) {
  const dates = upcomingDays(days, new Date(), stylistTimeZone)
  const [date, setDate] = useState(() => (value ? null : dates[0]))
  const activeDate = date || dates[0]
  const optionKey = (optionIds || []).join(',')

  const { data: slots, loading, error, reload } = useAsync(
    () => getSlots({ serviceId, date: activeDate, optionIds, excludeBookingId }),
    [serviceId, activeDate, optionKey, excludeBookingId],
  )

  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Choose a day">
        {dates.map((d) => {
          const l = dayChipLabel(d)
          const active = d === activeDate
          return (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => {
                setDate(d)
                onChange(null)
              }}
              className={`flex w-16 shrink-0 flex-col items-center rounded-[var(--radius-control)] border py-2 text-sm transition-colors ${
                active ? 'border-brown-deep bg-brown-deep text-cream' : 'border-sand bg-paper hover:border-brown'
              }`}
            >
              <span className={active ? 'text-cream/80' : 'text-stone'}>{l.weekday}</span>
              <span className="font-display text-xl">{l.day}</span>
              <span className={`text-xs ${active ? 'text-cream/80' : 'text-stone'}`}>{l.month}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 min-h-32">
        {loading ? (
          <LoadingState label="Checking availability…" className="py-8" />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !slots?.length ? (
          <p className="rounded-[var(--radius-control)] bg-sand-soft px-4 py-6 text-center text-stone">
            No free times on this day. Try another date.
          </p>
        ) : (
          <div className="space-y-4">
            {groupSlotsByPeriod(slots).map(([period, list]) => (
              <div key={period}>
                <p className="mb-2 text-sm text-stone">{period}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {list.map((s) => {
                    const active = value === s.slot_start
                    return (
                      <button
                        key={s.slot_start}
                        type="button"
                        onClick={() => onChange(s.slot_start)}
                        aria-pressed={active}
                        className={`rounded-full border px-2 py-2 text-sm transition-colors ${
                          active ? 'border-fuchsia bg-fuchsia text-white' : 'border-sand bg-paper hover:border-brown'
                        }`}
                      >
                        {formatTime(s.slot_start)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
