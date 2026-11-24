// Supabase clients for Edge Functions.
//
// - userClient(req): acts AS the signed-in user (their JWT), so RLS and
//   auth.uid() apply. Use it for anything the user is allowed to do.
// - adminClient(): uses the service-role key and BYPASSES RLS. Only use it for
//   server-only steps (svc_* functions) after checking permissions yourself.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import { HttpError, requireEnv } from './http.ts'

export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in.')
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Verify the caller's JWT with Supabase Auth and return the user. */
export async function requireUser(req: Request) {
  const client = userClient(req)
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.')
  return { user: data.user, client }
}

export async function requireAdmin(req: Request) {
  const { user, client } = await requireUser(req)
  const { data, error } = await client.rpc('is_admin')
  if (error || data !== true) throw new HttpError(403, 'Administrator access required.')
  return { user, client }
}

/**
 * Scheduled jobs (cron) call some functions with a shared secret header
 * instead of a user session. Compares in constant time.
 */
export function isCronRequest(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (!expected || !given || expected.length !== given.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}
