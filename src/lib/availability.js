/**
 * Date/time helpers for availability and booking.
 *
 * Times are stored in UTC in the database. The stylist's weekly hours are in
 * the stylist's own time zone; the server converts them (get_available_slots).
 * These helpers only format and group what the server returns.
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Canadian time zones offered in settings (add more as you expand). */
export const TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Moncton',
  'America/Toronto',
  'America/Winnipeg',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
]

export const userTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Do two [start, end) ranges overlap? Works with Date objects or ISO strings. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}

/** "YYYY-MM-DD" for a Date in a given time zone. */
export function toDateKey(date, timeZone = userTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(date))
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Next `count` calendar days starting today, as YYYY-MM-DD strings. */
export function upcomingDays(count, from = new Date(), timeZone = userTimeZone()) {
  const days = []
  for (let i = 0; i < count; i++) {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000)
    days.push(toDateKey(d, timeZone))
  }
  return [...new Set(days)]
}

/** Split slots into morning / afternoon / evening using the viewer's clock. */
export function groupSlotsByPeriod(slots, timeZone = userTimeZone()) {
  const groups = { Morning: [], Afternoon: [], Evening: [] }
  for (const slot of slots) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
        new Date(slot.slot_start),
      ),
    )
    if (hour < 12) groups.Morning.push(slot)
    else if (hour < 17) groups.Afternoon.push(slot)
    else groups.Evening.push(slot)
  }
  return Object.entries(groups).filter(([, list]) => list.length > 0)
}

export function formatTime(value, timeZone = userTimeZone()) {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  )
}

export function formatDate(value, timeZone = userTimeZone()) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatDateTime(value, timeZone = userTimeZone()) {
  return `${formatDate(value, timeZone)} · ${formatTime(value, timeZone)}`
}

/** Label for a YYYY-MM-DD key, e.g. "Tue 14". */
export function dayChipLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: d,
    month: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(date),
  }
}

/** Validate weekly working-hour windows for one weekday. Returns an error string or null. */
export function validateWindows(windows) {
  const sorted = [...windows].sort((a, b) => a.start_time.localeCompare(b.start_time))
  for (const w of sorted) {
    if (!w.start_time || !w.end_time) return 'Every time window needs a start and an end.'
    if (w.end_time <= w.start_time) return 'End time must be after start time.'
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_time < sorted[i - 1].end_time) return 'Time windows on the same day cannot overlap.'
  }
  return null
}

/** Convert a local date + time in the browser to an ISO UTC string. */
export function localDateTimeToIso(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`).toISOString()
}
