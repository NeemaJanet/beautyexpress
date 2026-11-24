import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { signalUnreadChanged } from '../../hooks/useUnreadCounts.js'
import { formatDate, formatTime } from '../../lib/availability.js'
import { friendlyError } from '../../lib/validation.js'
import { listConversations, listMessages, markConversationRead, sendMessage, subscribeToConversation } from '../../services/messageService.js'

export default function MessagesPage() {
  useDocumentTitle('Messages')
  const { conversationId } = useParams()
  const { user } = useAuth()
  const conversations = useAsync(() => listConversations(user.id), [user.id, conversationId])
  const active = conversations.data?.find((c) => c.id === conversationId)

  return (
    <div>
      <PageHeader title="Messages" description="Talk with your stylist or client. Keep payments and contact details inside BeautyExpress." />
      <div className="grid overflow-hidden rounded-[var(--radius-panel)] border border-sand bg-paper md:grid-cols-[280px_1fr]">
        <aside className={`${conversationId ? 'hidden md:block' : ''} border-sand md:border-r`}>
          {conversations.loading && !conversations.data ? (
            <LoadingState />
          ) : conversations.error ? (
            <ErrorState error={conversations.error} onRetry={conversations.reload} className="m-4" />
          ) : !conversations.data?.length ? (
            <div className="p-6 text-sm text-stone">
              No conversations yet. Message a stylist from their profile, or open a booking.
              <div className="mt-4"><Button to="/explore" size="sm">Find a stylist</Button></div>
            </div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {conversations.data.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/messages/${c.id}`}
                    className={`flex items-center gap-3 border-b border-sand px-4 py-3 ${c.id === conversationId ? 'bg-sand-soft' : 'hover:bg-sand-soft/60'}`}
                  >
                    <Avatar src={c.other.avatar} name={c.other.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${c.unread ? 'font-semibold' : ''}`}>{c.other.name}</p>
                      <p className="text-xs text-stone">{c.last_message_at ? formatDate(c.last_message_at) : 'No messages yet'}</p>
                    </div>
                    {c.unread && <span className="h-2 w-2 rounded-full bg-fuchsia" aria-label="Unread" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className={`${conversationId ? '' : 'hidden md:flex'} flex min-h-[60vh] flex-col`}>
          {conversationId ? (
            conversations.loading && !active ? (
              <LoadingState />
            ) : active ? (
              <Thread key={active.id} conversation={active} userId={user.id} onRead={conversations.reload} />
            ) : (
              <EmptyState title="Conversation not found" className="m-6" />
            )
          ) : (
            <div className="m-auto p-6 text-center text-stone">Choose a conversation.</div>
          )}
        </section>
      </div>
    </div>
  )
}

function Thread({ conversation, userId }) {
  const navigate = useNavigate()
  const messages = useAsync(() => listMessages(conversation.id), [conversation.id])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const { setData } = messages

  useEffect(() => {
    markConversationRead(conversation.id).then(signalUnreadChanged).catch(() => {})
    return subscribeToConversation(conversation.id, (msg) => {
      setData((list) => (list?.some((m) => m.id === msg.id) ? list : [...(list || []), msg]))
      if (msg.sender_id !== userId) markConversationRead(conversation.id).then(signalUnreadChanged).catch(() => {})
    })
  }, [conversation.id, userId, setData])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.data?.length])

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError(null)
    try {
      const msg = await sendMessage(conversation.id, userId, text)
      setData((list) => (list?.some((m) => m.id === msg.id) ? list : [...(list || []), msg]))
      setText('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSending(false)
    }
  }

  let lastDay = null
  return (
    <>
      <header className="flex items-center gap-3 border-b border-sand px-4 py-3">
        <button className="md:hidden" onClick={() => navigate('/messages')} aria-label="Back to conversations">‹</button>
        <Avatar src={conversation.other.avatar} name={conversation.other.name} size="sm" />
        <p className="font-medium">{conversation.other.name}</p>
        {conversation.booking_id && (
          <Link to={`/bookings/${conversation.booking_id}`} className="ml-auto text-sm text-stone hover:text-ink">Latest booking</Link>
        )}
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ maxHeight: '55vh' }} aria-live="polite">
        {messages.loading && !messages.data ? (
          <LoadingState />
        ) : !messages.data?.length ? (
          <p className="py-10 text-center text-sm text-stone">Say hello and share any details about the style you want.</p>
        ) : (
          messages.data.map((m) => {
            const mine = m.sender_id === userId
            const day = formatDate(m.created_at)
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={m.id}>
                {showDay && <p className="my-3 text-center text-xs text-stone">{day}</p>}
                <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${mine ? 'rounded-br-sm bg-brown-deep text-cream' : 'rounded-bl-sm bg-sand-soft text-ink'}`}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`mt-1 text-[11px] ${mine ? 'text-cream/60' : 'text-stone'}`}>{formatTime(m.created_at)}</p>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="border-t border-sand p-3">
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <label htmlFor="message-input" className="sr-only">Message</label>
          <textarea
            id="message-input"
            rows={1}
            maxLength={2000}
            className="control resize-none"
            placeholder="Write a message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(e)
              }
            }}
          />
          <Button type="submit" loading={sending} disabled={!text.trim()}>Send</Button>
        </div>
      </form>
    </>
  )
}
