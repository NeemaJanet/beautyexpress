import { LoadingState } from '../../components/common/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { getPublicSettings } from '../../services/catalogService.js'
import { LegalNotice } from './LegalNotice.jsx'

/** The numbers on this page come from the live platform settings. */
export default function CancellationPolicyPage() {
  useDocumentTitle('Cancellation and refund policy')
  const { data: s, loading } = useAsync(getPublicSettings, [])
  if (loading) return <LoadingState className="min-h-[40vh]" />
  const hours = s?.free_cancellation_hours ?? 24
  const fee = s?.late_cancellation_fee_percent ?? 0

  return (
    <article className="container-page prose-legal py-14">
      <h1 className="mb-6 text-4xl">Cancellation and refund policy</h1>
      <LegalNotice />

      <h2>If you cancel</h2>
      <ul>
        <li>More than {hours} hours before your appointment: full refund of anything you paid online.</li>
        <li>
          Less than {hours} hours before a confirmed appointment: {fee}% of the amount you paid online is kept as a
          late-cancellation fee and the rest is refunded.
        </li>
        <li>Requests the stylist has not yet confirmed can always be cancelled for a full refund.</li>
        <li>You can reschedule online until {hours} hours before the appointment.</li>
      </ul>

      <h2>If the stylist cancels or declines</h2>
      <p>You receive a full refund of everything you paid online.</p>

      <h2>No-shows</h2>
      <p>
        If you do not arrive and do not cancel, the stylist may mark the booking as a no-show 15 minutes after the start
        time. Amounts paid online are not refunded. If you believe this is wrong, open a dispute from the booking page.
      </p>

      <h2>When refunds arrive</h2>
      <p>
        Card refunds are sent to Stripe immediately and usually appear on your statement within 5–10 business days.
        Manual e-Transfer refunds are sent by our team after review.
      </p>

      <h2>Disputes</h2>
      <p>
        If the service was not as described, open a dispute from the booking page within 30 days. Payouts to the stylist
        are paused while we review it.
      </p>
    </article>
  )
}
