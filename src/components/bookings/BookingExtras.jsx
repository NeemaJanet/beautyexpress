import { useState } from 'react'
import { useToast } from '../../contexts/ToastContext.jsx'
import { formatDate } from '../../lib/availability.js'
import { friendlyError } from '../../lib/validation.js'
import { openDispute, replyToReview, respondToDispute, submitReview, updateReview } from '../../services/bookingService.js'
import { Badge } from '../common/Badge.jsx'
import { Button } from '../common/Button.jsx'
import { FormError, Input, TextArea } from '../common/Field.jsx'
import { Modal } from '../common/Modal.jsx'
import { RatingStars } from '../common/RatingStars.jsx'

/** Review form (client) or review + reply (stylist). */
export function ReviewSection({ booking, viewer, userId, onChanged }) {
  const toast = useToast()
  const review = booking.review
  const [rating, setRating] = useState(review?.rating || 0)
  const [comment, setComment] = useState(review?.comment || '')
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (booking.status !== 'completed') return null

  const save = async () => {
    if (!rating) return setError('Choose a star rating.')
    setBusy(true)
    setError(null)
    try {
      if (review) await updateReview(review.id, { rating, comment: comment.trim() })
      else await submitReview({ bookingId: booking.id, clientId: userId, rating, comment })
      toast.success('Thanks for your review')
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(/row-level security/i.test(e.message) ? 'The review window for this booking has closed.' : friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const sendReply = async () => {
    setBusy(true)
    setError(null)
    try {
      await replyToReview(review.id, reply.trim())
      toast.success('Reply posted')
      onChanged()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-6">
      <h2 className="mb-4 font-sans text-lg font-semibold">Review</h2>
      {viewer === 'client' && (!review || editing) ? (
        <div className="space-y-4">
          <RatingStars value={rating} onChange={setRating} size="lg" />
          <TextArea label="What went well, or what could be better? (optional)" rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <FormError error={error} />
          <Button onClick={save} loading={busy}>{review ? 'Save review' : 'Post review'}</Button>
        </div>
      ) : review ? (
        <div>
          <RatingStars value={review.rating} />
          {review.comment && <p className="mt-2 text-ink-soft">{review.comment}</p>}
          {review.is_hidden && <Badge tone="red" className="mt-2">Hidden by moderators</Badge>}
          {review.stylist_reply && (
            <p className="mt-3 border-l-2 border-fuchsia pl-3 text-sm text-ink-soft">Reply: {review.stylist_reply}</p>
          )}
          {viewer === 'client' && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setEditing(true)}>Edit review</Button>}
          {viewer === 'stylist' && !review.stylist_reply && (
            <div className="mt-4 space-y-3">
              <TextArea label="Public reply" rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
              <FormError error={error} />
              <Button size="sm" onClick={sendReply} loading={busy} disabled={!reply.trim()}>Post reply</Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-stone">The client has not left a review yet.</p>
      )}
    </section>
  )
}

const DISPUTE_LABELS = {
  open: 'Open',
  under_review: 'Under review',
  resolved_refund: 'Resolved with refund',
  resolved_no_refund: 'Resolved without refund',
  closed: 'Closed',
}

/** Open a dispute and see its progress. */
export function DisputeSection({ booking, userId, onChanged }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ reason: '', description: '' })
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const eligible = !['pending_payment', 'expired'].includes(booking.status)
  const hasOpen = booking.disputes?.some((d) => ['open', 'under_review'].includes(d.status))

  if (!eligible && !booking.disputes?.length) return null

  const submit = async () => {
    if (form.reason.trim().length < 3 || form.description.trim().length < 10) return setError('Add a short reason and a description of what happened.')
    setBusy(true)
    setError(null)
    try {
      await openDispute(booking.id, form.reason.trim(), form.description.trim())
      toast.success('Dispute opened. Our team will review it.')
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const respond = async (id) => {
    setBusy(true)
    try {
      await respondToDispute(id, response.trim())
      toast.success('Response sent')
      setResponse('')
      onChanged()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-6">
      <h2 className="mb-2 font-sans text-lg font-semibold">Problems with this booking</h2>
      {booking.disputes?.map((d) => (
        <div key={d.id} className="mb-4 rounded-[var(--radius-control)] bg-sand-soft p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{d.reason}</p>
            <Badge tone={['open', 'under_review'].includes(d.status) ? 'amber' : 'gray'}>{DISPUTE_LABELS[d.status]}</Badge>
          </div>
          <p className="mt-1 text-ink-soft">{d.description}</p>
          <p className="mt-1 text-xs text-stone">Opened {formatDate(d.created_at)}{d.opened_by === userId ? ' by you' : ''}</p>
          {d.stylist_response && <p className="mt-2 border-l-2 border-fuchsia pl-3">Response: {d.stylist_response}</p>}
          {d.resolution_notes && <p className="mt-2 border-l-2 border-ink pl-3">Decision: {d.resolution_notes}</p>}
          {['open', 'under_review'].includes(d.status) && d.opened_by !== userId && !d.stylist_response && (
            <div className="mt-3 space-y-2">
              <TextArea label="Your side of the story" rows={3} maxLength={4000} value={response} onChange={(e) => setResponse(e.target.value)} />
              <Button size="sm" onClick={() => respond(d.id)} loading={busy} disabled={!response.trim()}>Send response</Button>
            </div>
          )}
        </div>
      ))}
      {eligible && !hasOpen && (
        <>
          <p className="mb-3 text-sm text-stone">If something went wrong and you can’t resolve it by message, our team can step in.</p>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Open a dispute</Button>
        </>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Open a dispute"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={busy}>Submit dispute</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Reason" placeholder="Service not as described" maxLength={150} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <TextArea label="What happened?" rows={5} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <p className="text-sm text-stone">Payouts for this booking are paused while we review.</p>
          <FormError error={error} />
        </div>
      </Modal>
    </section>
  )
}
