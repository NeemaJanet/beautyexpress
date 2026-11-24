import { supabase } from '../lib/supabase.js'

const origin = () => window.location.origin

/** role is 'client' or 'stylist' — the database ignores anything else. */
export async function signUp({ email, password, fullName, role }) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: fullName.trim(), role },
      emailRedirectTo: `${origin()}/onboarding`,
    },
  })
  if (error) throw error
  return data
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    if (/Invalid login/i.test(error.message)) throw new Error('That email and password do not match an account.')
    if (/Email not confirmed/i.test(error.message)) throw new Error('Please confirm your email first — check your inbox.')
    throw error
  }
  return data
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origin()}/reset-password`,
  })
  if (error) throw error
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function updateEmail(email) {
  const { error } = await supabase.auth.updateUser(
    { email: email.trim() },
    { emailRedirectTo: `${origin()}/client/profile` },
  )
  if (error) throw error
}

export async function updateProfile(userId, fields) {
  const { data, error } = await supabase.from('profiles').update(fields).eq('id', userId).select().single()
  if (error) throw error
  return data
}
