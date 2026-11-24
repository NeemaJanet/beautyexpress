import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { signalUnreadChanged } from '../../hooks/useUnreadCounts.js'
import { formatDateTime } from '../../lib/availability.js'
import { deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/notificationService.js'

export default function NotificationsPage() {
  useDocumentTitle('Notifications')
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const list = useAsync(() => listNotifications(user.id), [user.id])
  const unread = list.data?.filter((n) => !n.read_at).length || 0

  const open = async (n) => {
    if (!n.read_at) {
      await markNotificationRead(n.id).catch(() => {})
      signalUnreadChanged()
    }
    if (n.link) navigate(n.link)
    else list.reload()
  }

  const markAll = async () => {
    await markAllNotificationsRead(user.id)
    signalUnreadChanged()
    list.reload()
    toast.success('All caught up')
  }

  const remove = async (id) => {
    await deleteNotification(id)
    list.setData((rows) => rows.filter((r) => r.id !== id))
    signalUnreadChanged()
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        actions={unread > 0 && <Button variant="secondary" size="sm" onClick={markAll}>Mark all as read</Button>}
      />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload} isEmpty={!list.data?.length}
        empty={<EmptyState title="No notifications yet">Booking updates, messages and reminders will appear here.</EmptyState>}>
        <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper">
          {list.data?.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 px-4 py-4 ${n.read_at ? '' : 'bg-fuchsia-soft/30'}`}>
              {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-fuchsia" aria-label="Unread" />}
              <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                <p className={`text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                <p className="mt-1 text-xs text-stone">{formatDateTime(n.created_at)}</p>
              </button>
              <button onClick={() => remove(n.id)} className="rounded-full px-2 text-stone hover:bg-sand-soft hover:text-ink" aria-label={`Delete notification: ${n.title}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
    </div>
  )
}
