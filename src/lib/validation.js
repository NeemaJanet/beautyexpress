/**
 * Form validation helpers. These give friendly, instant feedback in the
 * browser. The database repeats the important checks (constraints, RLS and
 * functions), so bypassing these in the browser does not bypass security.
 */

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim())

export function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.'
  return null
}

export const isPhone = (v) => /^\+?[0-9 ()-]{7,20}$/.test(String(v || '').trim())

/** Canadian postal code (A1A 1A1); returns normalised value or null. */
export function normalizePostalCode(v) {
  const s = String(v || '').toUpperCase().replace(/\s+/g, '')
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(s)) return `${s.slice(0, 3)} ${s.slice(3)}`
  return null
}

/**
 * Run a set of rules against form values.
 * rules: { fieldName: [ (value, allValues) => errorString|null, ... ] }
 * Returns { fieldName: firstError } for failing fields.
 */
export function validate(values, rules) {
  const errors = {}
  for (const [field, checks] of Object.entries(rules)) {
    for (const check of checks) {
      const err = check(values[field], values)
      if (err) {
        errors[field] = err
        break
      }
    }
  }
  return errors
}

export const required =
  (msg = 'This field is required.') =>
  (v) =>
    v === undefined || v === null || String(v).trim() === '' ? msg : null

export const maxLength = (n) => (v) => (v && String(v).length > n ? `Use ${n} characters or fewer.` : null)
export const minLength = (n) => (v) => (v && String(v).trim().length < n ? `Use at least ${n} characters.` : null)

export const numberBetween = (min, max, msg) => (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return msg || `Enter a number between ${min} and ${max}.`
  return null
}

export const email = () => (v) => (v && !isEmail(v) ? 'Enter a valid email address.' : null)
export const phone = () => (v) => (v && !isPhone(v) ? 'Enter a valid phone number.' : null)

/** Turn a Supabase/Postgres error into a message a person can act on. */
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (/JWT|not authenticated|28000/i.test(msg) || error.code === '28000') return 'Please sign in again.'
  if (error.code === '42501' && !/[A-Z][a-z]+ .*\./.test(msg)) return 'You do not have permission to do that.'
  if (/row-level security/i.test(msg)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(msg)) return 'That already exists.'
  if (/violates check constraint/i.test(msg)) return 'Some values are not allowed. Please check the form.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network problem — check your connection and try again.'
  return msg
}

/** Escape characters with special meaning in PostgREST ilike filters. */
export function escapeLike(value) {
  return String(value || '').replace(/[%_,()\\]/g, (c) => `\\${c}`)
}
