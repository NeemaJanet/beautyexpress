// Shared HTTP helpers for all Edge Functions.

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('APP_URL') ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allow = allowedOrigins.includes('*') || allowedOrigins.includes(origin) ? origin || '*' : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Map a Postgres/PostgREST error to a user-facing HttpError. */
export function fromDbError(error: { message?: string; code?: string } | null): HttpError {
  const message = error?.message ?? 'Database error'
  const code = error?.code ?? ''
  if (code === 'P0404') return new HttpError(404, message)
  if (code === 'P0409') return new HttpError(409, message)
  if (code === 'P0410') return new HttpError(410, message)
  if (code === 'P0429') return new HttpError(429, message)
  if (code === '42501') return new HttpError(403, message)
  if (code === '28000') return new HttpError(401, message)
  if (code.startsWith('P0')) return new HttpError(422, message)
  console.error('Unexpected database error', error)
  return new HttpError(500, 'Something went wrong. Please try again.')
}

/**
 * Wrap a handler: handles CORS preflight, method checks, JSON parsing and
 * turns thrown errors into safe JSON responses (no stack traces leak).
 */
export function handler(fn: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
    try {
      const text = await req.text()
      if (text.length > 20_000) throw new HttpError(413, 'Request too large')
      let body: Record<string, unknown> = {}
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          throw new HttpError(400, 'Invalid JSON body')
        }
      }
      return await fn(req, body)
    } catch (err) {
      if (err instanceof HttpError) return json(req, { error: err.message }, err.status)
      console.error(err)
      return json(req, { error: 'Something went wrong. Please try again.' }, 500)
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, `${name} must be a valid id`)
  return value
}

export function optionalString(value: unknown, name: string, max = 500): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`)
  if (value.length > max) throw new HttpError(400, `${name} is too long`)
  return value
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new HttpError(503, `Server is not configured: missing ${name}. See DEPLOYMENT.md.`)
  return v
}
