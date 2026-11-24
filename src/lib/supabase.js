/**
 * The Supabase client used by the whole frontend.
 *
 * It uses the PUBLIC "anon" key, which is safe in the browser: every table is
 * protected by Row Level Security in the database. Never put the service-role
 * key in the frontend or in any VITE_ variable.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

/** Throw the Supabase error if there is one, otherwise return data. */
export function unwrap({ data, error }) {
  if (error) throw error
  return data
}

/**
 * Call an Edge Function and return its JSON. Turns error responses into
 * Error objects with the server's (user-safe) message.
 */
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    try {
      const payload = await error.context?.json?.()
      if (payload?.error) message = payload.error
    } catch {
      // keep the default message
    }
    if (/Failed to send a request/i.test(message)) {
      message = `The ${name} service is not reachable. Has it been deployed? (See DEPLOYMENT.md)`
    }
    throw new Error(message)
  }
  return data
}

export const storageUrl = (bucket, path) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
