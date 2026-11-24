import { formatDateTime } from '../../lib/availability.js'
import { STATUS_LABELS } from '../../lib/bookingStatus.js'

export function StatusTimeline({ history }) {
  if (!history?.length) return null
  return (
    <ol className="relative space-y-4 border-l border-sand pl-5">
      {history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper bg-fuchsia" aria-hidden="true" />
          <p className="text-sm font-medium">{STATUS_LABELS[h.to_status]}</p>
          <p className="text-xs text-stone">{formatDateTime(h.created_at)}</p>
          {h.reason && h.reason !== 'Booking created' && <p className="mt-0.5 text-sm text-ink-soft">{h.reason}</p>}
        </li>
      ))}
    </ol>
  )
}
