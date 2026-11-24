/**
 * Who is signed in, their profile and their roles.
 *
 * Roles are read from the database (user_roles). Hiding a page based on a
 * role is only a convenience — the database refuses unauthorised actions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [roles, setRoles] = useState([])
  const [stylistProfile, setStylistProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recoveryMode, setRecoveryMode] = useState(false)

  const loadUserData = useCallback(async (user) => {
    if (!user) {
      setProfile(null)
      setRoles([])
      setStylistProfile(null)
      return
    }
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', user.id),
    ])
    const roleList = (r.data || []).map((x) => x.role)
    setProfile(p.data || null)
    setRoles(roleList)
    if (roleList.includes('stylist')) {
      const s = await supabase.from('stylist_profiles').select('*').eq('id', user.id).maybeSingle()
      setStylistProfile(s.data || null)
    } else {
      setStylistProfile(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadUserData(data.session?.user)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
      // Defer database calls out of the auth callback (recommended by Supabase).
      setTimeout(() => {
        loadUserData(newSession?.user).finally(() => setLoading(false))
      }, 0)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadUserData])

  const refresh = useCallback(() => loadUserData(session?.user), [loadUserData, session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setRoles([])
    setStylistProfile(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      roles,
      stylistProfile,
      loading,
      recoveryMode,
      setRecoveryMode,
      isAdmin: roles.includes('admin'),
      isStylist: roles.includes('stylist'),
      isSuspended: profile?.status === 'suspended',
      refresh,
      signOut,
    }),
    [session, profile, roles, stylistProfile, loading, recoveryMode, refresh, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Where should this person land after signing in? */
// eslint-disable-next-line react-refresh/only-export-components
export function homePathFor({ profile, isAdmin, isStylist, stylistProfile }) {
  if (isStylist && !stylistProfile?.onboarding_completed) return '/onboarding'
  if (!profile?.onboarding_completed && !isStylist) return '/onboarding'
  if (isAdmin) return '/admin'
  if (isStylist) return '/stylist/dashboard'
  return '/client/dashboard'
}
