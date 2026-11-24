import { describe, expect, it } from 'vitest'
import { escapeLike, friendlyError, isEmail, isPhone, normalizePostalCode, required, validate, validatePassword } from '../../src/lib/validation.js'
import { safeNext } from '../../src/utils/navigation.js'

describe('validation helpers', () => {
  it('emails and phones', () => {
    expect(isEmail('a@b.ca')).toBe(true)
    expect(isEmail('nope@')).toBe(false)
    expect(isPhone('+1 506 555 0100')).toBe(true)
    expect(isPhone('call me')).toBe(false)
  })
  it('passwords need length, letters and numbers', () => {
    expect(validatePassword('short1')).toMatch(/8/)
    expect(validatePassword('longpassword')).toMatch(/number/)
    expect(validatePassword('longpassword1')).toBeNull()
  })
  it('normalises Canadian postal codes', () => {
    expect(normalizePostalCode('e3b0a1')).toBe('E3B 0A1')
    expect(normalizePostalCode('12345')).toBeNull()
  })
  it('validate() returns the first error per field', () => {
    expect(validate({ name: '' }, { name: [required('Name please')] })).toEqual({ name: 'Name please' })
    expect(validate({ name: 'Jo' }, { name: [required()] })).toEqual({})
  })
  it('escapes search wildcards', () => {
    expect(escapeLike('50%_off,(x)')).toBe('50\\%\\_off\\,\\(x\\)')
  })
  it('turns database errors into plain language', () => {
    expect(friendlyError({ message: 'new row violates row-level security policy for table "x"' })).toMatch(/permission/)
    expect(friendlyError({ message: 'That time is no longer available.', code: 'P0409' })).toBe('That time is no longer available.')
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/Network/)
  })
})

describe('safeNext (prevents open redirects after sign-in)', () => {
  it('allows only same-site paths', () => {
    expect(safeNext('/bookings/1')).toBe('/bookings/1')
    expect(safeNext('https://evil.example')).toBeNull()
    expect(safeNext('//evil.example')).toBeNull()
    expect(safeNext(null)).toBeNull()
  })
})
