import { supabase, unwrap } from '../lib/supabase.js'

export const listNotifications = async (userId, limit = 50) =>
  unwrap(
    await supabase
      .from('notifications')
      .select('id, type, title, body, link, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
  )

export const markNotificationRead = async (id) =>
  unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null))

export const markAllNotificationsRead = async (userId) =>
  unwrap(
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null),
  )

export const deleteNotification = async (id) => unwrap(await supabase.from('notifications').delete().eq('id', id))
