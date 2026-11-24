/**
 * Database test helpers.
 *
 * These tests run the REAL migrations against a PostgreSQL server. They need
 * an admin connection string in TEST_DATABASE_URL, for example:
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres npm run test:db
 *
 * (54322 is the port used by `supabase start`.) Each test file creates its own
 * throw-away database, so your development data is never touched.
 *
 * On a plain PostgreSQL server (not Supabase) the helper first loads
 * tests/db/supabase-stub.sql to create the auth schema and API roles.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const root = path.resolve(import.meta.dirname, '../../..')
export const ADMIN_URL = process.env.TEST_DATABASE_URL
export const hasDatabase = Boolean(ADMIN_URL)

export const IDS = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  client1: 'c0000000-0000-4000-8000-000000000001',
  client2: 'c0000000-0000-4000-8000-000000000002',
  stylist1: '50000000-0000-4000-8000-000000000001', // instant booking, mobile + studio
  stylist2: '50000000-0000-4000-8000-000000000002', // salon, approval booking
  stylist3: '50000000-0000-4000-8000-000000000003',
  stylist6: '50000000-0000-4000-8000-000000000006', // not onboarded
  knotless: '55000000-0000-4000-8000-000000000001', // stylist1, has "Length" choose-one group
  cornrows: '55000000-0000-4000-8000-000000000002', // stylist1, no options
  silkPress: '55000000-0000-4000-8000-000000000003', // stylist2, salon only
  optShoulder: '0b000000-0000-4000-8000-000000000001',
  optMidBack: '0b000000-0000-4000-8000-000000000002',
  optCurly: '0b000000-0000-4000-8000-000000000004',
  client1Address: 'ad000000-0000-4000-8000-000000000001',
  completedBooking: 'b0000000-0000-4000-8000-000000000001',
  confirmedBooking: 'b0000000-0000-4000-8000-000000000002',
  requestedBooking: 'b0000000-0000-4000-8000-000000000003',
}

function dbUrl(name) {
  const u = new URL(ADMIN_URL)
  u.pathname = `/${name}`
  return u.toString()
}

/** Create a fresh database with migrations + seed. Returns { pool, drop }. */
export async function createTestDatabase() {
  const name = `beautyexpress_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database ${name}`)
  await admin.end()

  const setup = new pg.Client({ connectionString: dbUrl(name) })
  await setup.connect()
  const { rows } = await setup.query(`select exists(select 1 from pg_namespace where nspname = 'auth') as has_auth`)
  if (!rows[0].has_auth) {
    await setup.query(fs.readFileSync(path.join(root, 'tests/db/supabase-stub.sql'), 'utf8'))
  }
  const migrationsDir = path.join(root, 'supabase/migrations')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await setup.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  await setup.query(fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'))
  await setup.end()

  const pool = new pg.Pool({ connectionString: dbUrl(name), max: 6 })
  return {
    pool,
    async drop() {
      await pool.end()
      const c = new pg.Client({ connectionString: ADMIN_URL })
      await c.connect()
      await c.query(`drop database if exists ${name} with (force)`)
      await c.end()
    },
  }
}

/**
 * Run `fn(client)` as a given API user inside a transaction that is rolled
 * back afterwards (unless commit = true).
 * who: a user id (authenticated), 'anon', or 'service_role'.
 */
export async function as(pool, who, fn, { commit = false } = {}) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (who === 'anon') {
      await client.query(`set local role anon`)
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`)
    } else if (who === 'service_role') {
      await client.query(`set local role service_role`)
      await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
    } else {
      await client.query(`set local role authenticated`)
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: who, role: 'authenticated' }),
      ])
    }
    const result = await fn(client)
    await client.query(commit ? 'commit' : 'rollback')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Run SQL as the database owner (bypasses RLS) — for test setup only. */
export async function asOwner(pool, sql, params = []) {
  return pool.query(sql, params)
}

/** Expect a promise to reject with a message matching `pattern`. */
export async function expectError(promise, pattern) {
  try {
    await promise
  } catch (err) {
    if (pattern && !pattern.test(err.message)) {
      throw new Error(`Expected error matching ${pattern}, got: ${err.message}`, { cause: err })
    }
    return err
  }
  throw new Error(`Expected an error matching ${pattern} but the call succeeded`)
}

/**
 * Find the first free slot for a stylist service at least `minDaysAhead` days
 * from now. Returns an ISO string.
 */
export async function firstFreeSlot(pool, stylistServiceId, optionIds = [], minDaysAhead = 2) {
  const { rows } = await pool.query(
    `select s.slot_start from generate_series(current_date + $3::int, current_date + 30, interval '1 day') d,
       lateral public.get_available_slots($1, d::date, $2::uuid[]) s
     order by s.slot_start limit 1`,
    [stylistServiceId, optionIds, minDaysAhead],
  )
  if (!rows.length) throw new Error('No free slot found')
  return rows[0].slot_start.toISOString()
}

export async function setSetting(pool, key, value) {
  await pool.query(`update public.platform_settings set value = $2::jsonb where key = $1`, [
    key,
    JSON.stringify(value),
  ])
}
