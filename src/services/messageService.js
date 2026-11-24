import { supabase, unwrap } from '../lib/supabase.js'

/** Conversations for the signed-in user with the other person's name. */
export async function listConversations(userId) {
  const convs = unwrap(
    await supabase
      .from('conversations')
      .select('id, client_id, stylist_id, booking_id, last_message_at, created_at, stylist_profiles(display_name, business_name, avatar_url), conversation_participants(user_id, last_read_at)')
      .order('last_message_at', { ascending: false, nullsFirst: false }),
  )
  const clientIds = [...new Set(convs.filter((c) => c.stylist_id === userId).map((c) => c.client_id))]
  const clients = clientIds.length
    ? unwrap(await supabase.from('profiles').select('id, full_name, avatar_url').in('id', clientIds))
    : []
  const byId = Object.fromEntries(clients.map((c) => [c.id, c]))
  return convs.map((c) => {
    const iAmStylist = c.stylist_id === userId
    const other = iAmStylist
      ? { id: c.client_id, name: byId[c.client_id]?.full_name || 'Client', avatar: byId[c.client_id]?.avatar_url }
      : { id: c.stylist_id, name: c.stylist_profiles?.display_name || 'Stylist', avatar: c.stylist_profiles?.avatar_url }
    const me = c.conversation_participants?.find((p) => p.user_id === userId)
    const unread = c.last_message_at && (!me?.last_read_at || new Date(c.last_message_at) > new Date(me.last_read_at))
    return { ...c, other, unread }
  })
}

export const listMessages = async (conversationId, limit = 200) =>
  unwrap(
    await supabase
      .from('messages')
      .select('id, sender_id, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit),
  )

export const sendMessage = async (conversationId, senderId, body) =>
  unwrap(
    await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: senderId, body: body.trim() }).select().single(),
  )

export const startConversation = async (otherUserId) => {
  const id = unwrap(await supabase.rpc('get_or_create_conversation', { p_other_user: otherUserId }))
  if (!id) throw new Error('You can message this person once you have a booking together.')
  return id
}

export const markConversationRead = async (conversationId) =>
  unwrap(await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }))

/** Live updates for one conversation. Returns an unsubscribe function. */
export function subscribeToConversation(conversationId, onMessage) {
  const channel = supabase
    .channel(`conversation-${conversationId}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
