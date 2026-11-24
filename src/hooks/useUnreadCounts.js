/** Live unread message and notification counts for the navigation badges. */
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

export function useUnreadCounts() {
  const { user } = useAuth()
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 })

  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.rpc('my_unread_counts')
      if (!cancelled && data) setCounts(data)
    }
    load()
    // Realtime: refresh when a new notification or message arrives.
    const channel = supabase
      .channel(`unread-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, load)
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('beautyexpress:unread-changed', onFocus)
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beautyexpress:unread-changed', onFocus)
    }
  }, [user])

  return user ? counts : { notifications: 0, messages: 0 }
}

/** Tell the badges to refresh after marking things read. */
export const signalUnreadChanged = () => window.dispatchEvent(new Event('beautyexpress:unread-changed'))
