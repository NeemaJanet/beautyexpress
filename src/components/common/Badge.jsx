import { PAYMENT_STATUS_LABELS, STATUS_LABELS, STATUS_TONES } from '../../lib/bookingStatus.js'

const tones = {
  gray: 'bg-sand-soft text-ink-soft',
  green: 'bg-success-soft text-success',
  amber: 'bg-warn-soft text-warn',
  red: 'bg-danger-soft text-danger',
  blue: 'bg-info-soft text-info',
  fuchsia: 'bg-fuchsia-soft text-fuchsia-deep',
  brown: 'bg-brown-soft text-brown-deep',
  ink: 'bg-brown-deep text-cream',
}

export function Badge({ tone = 'gray', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] || 'gray'}>{STATUS_LABELS[status] || status}</Badge>
}

const paymentTones = {
  succeeded: 'green',
  requires_payment: 'amber',
  awaiting_verification: 'amber',
  processing: 'blue',
  failed: 'red',
  canceled: 'gray',
  refunded: 'gray',
  partially_refunded: 'blue',
  pending: 'amber',
  transferred: 'green',
  reversed: 'red',
}

export function PaymentBadge({ status }) {
  return <Badge tone={paymentTones[status] || 'gray'}>{PAYMENT_STATUS_LABELS[status] || status.replace(/_/g, ' ')}</Badge>
}

export function VerifiedBadge() {
  return (
    <Badge tone="green" className="whitespace-nowrap">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M10 1.5l2.2 1.6 2.7-.1.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.1L10 18.5l-2.2-1.6-2.7.1-.9-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.9-2.6 2.7.1L10 1.5zm-1.2 11.2l5-5-1.1-1.1-3.9 3.9-1.8-1.8-1.1 1.1 2.9 2.9z" />
      </svg>
      Verified
    </Badge>
  )
}
