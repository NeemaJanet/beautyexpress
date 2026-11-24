/**
 * Database helper you can run from the VS Code terminal (no Docker needed).
 *
 *   npm run db:check     show whether the database is set up and what is in it
 *   npm run db:setup     create all tables, security rules and functions (new project only)
 *   npm run db:seed      load the FICTIONAL demo accounts and data (development only)
 *   npm run db:fix-demo  repair demo accounts so they can sign in
 *
 * It reads the connection string from the file  .env.database :
 *   DATABASE_URL=postgresql://postgres.xxxx:YOUR-PASSWORD@aws-0-ca-central-1.pooler.supabase.com:5432/postgres
 * (Supabase dashboard > Connect > "Session pooler"). That file is git-ignored and
 * is NOT read by the website, so your database password never reaches the browser.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const root = path.resolve(import.meta.dirname, '..')
const command = process.argv[2]

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const file = path.join(root, '.env.database')
  if (!fs.existsSync(file)) {
    fail(
      'Missing file .env.database\n\n' +
        'Create it with:   copy .env.database.example .env.database   then   code .env.database\n' +
        'and paste your Supabase "Session pooler" connection string (see SETUP-WITHOUT-DOCKER.md).',
    )
  }
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('DATABASE_URL='))
  const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  if (!value || value.includes('YOUR-PASSWORD')) {
    fail('DATABASE_URL in .env.database is empty or still contains YOUR-PASSWORD. Paste your real connection string.')
  }
  return value
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

function friendly(err) {
  const m = err.message || String(err)
  if (/password authentication failed/i.test(m)) return 'Wrong database password in .env.database. Reset it in Supabase > Project Settings > Database.'
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'Cannot find the database server. Check the host name in .env.database (use the "Session pooler" string).'
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(m)) return 'Could not connect. Check your internet connection and that you used the "Session pooler" string, not "Direct connection".'
  if (/Tenant or user not found/i.test(m)) return 'The user name in the connection string is wrong. Copy the full "Session pooler" string again.'
  return m
}

async function withClient(fn) {
  const connectionString = readDatabaseUrl()
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)
  const client = new pg.Client({
    connectionString,
    // Supabase requires an encrypted connection. Its certificate is signed by
    // Supabase's own authority, so we encrypt without checking the certificate
    // chain. This tool is for setup and development only.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })
  try {
    await client.connect()
  } catch (err) {
    fail(friendly(err))
  }
  try {
    return await fn(client)
  } catch (err) {
    fail(friendly(err))
  } finally {
    await client.end().catch(() => {})
  }
}

const tablesExist = async (c) =>
  (await c.query(`select to_regclass('public.bookings') is not null as ok`)).rows[0].ok

const demoCount = async (c) =>
  Number((await c.query(`select count(*) from auth.users where email like '%@example.com'`)).rows[0].count)

async function runFile(c, relative) {
  const sql = fs.readFileSync(path.join(root, relative), 'utf8')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
  } catch (err) {
    await c.query('rollback').catch(() => {})
    throw err
  }
}

const commands = {
  async check(c) {
    console.log('✔ Connected to the database.')
    if (!(await tablesExist(c))) {
      console.log('✖ Tables are missing. Run:  npm run db:setup')
      return
    }
    const r = (
      await c.query(`select
        (select count(*) from public.stylist_profiles) as stylists,
        (select count(*) from public.bookings) as bookings,
        (select count(*) from public.profiles) as users`)
    ).rows[0]
    console.log(`✔ Tables exist: ${r.users} users, ${r.stylists} stylist profiles, ${r.bookings} bookings.`)
    const demo = await demoCount(c)
    console.log(demo ? `✔ ${demo} demo accounts found (password Password123!).` : '• No demo accounts. To add them:  npm run db:seed')
    if (demo) {
      const broken = (
        await c.query(`select count(*) from auth.users where email like '%@example.com'
          and (confirmation_token is null or recovery_token is null)`)
      ).rows[0].count
      if (Number(broken)) console.log(`✖ ${broken} demo accounts cannot sign in yet. Run:  npm run db:fix-demo`)
    }
  },

  async setup(c) {
    if (await tablesExist(c)) {
      console.log('✔ The database is already set up — nothing to do. (Run npm run db:check to see what is in it.)')
      return
    }
    console.log('Creating tables, security rules and functions… (about 10–30 seconds)')
    await runFile(c, 'supabase/setup-hosted.sql')
    console.log('✔ Database set up. Next, for demo data:  npm run db:seed')
  },

  async seed(c) {
    if (!(await tablesExist(c))) fail('Run  npm run db:setup  first.')
    if (await demoCount(c)) {
      console.log('✔ Demo data is already loaded. If sign-in fails, run:  npm run db:fix-demo')
      return
    }
    console.log('Loading FICTIONAL demo data (development only — never on your real launch project)…')
    await runFile(c, 'supabase/seed.sql')
    console.log('✔ Demo data loaded. Sign in with client1@example.com / Password123!')
  },

  async 'fix-demo'(c) {
    const { rows } = await c.query(`select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = any($1)`, [
      ['confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
        'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'],
    ])
    const sets = rows.map((r) => `${r.column_name} = coalesce(${r.column_name}, '')`).join(', ')
    const res = await c.query(`update auth.users set ${sets} where email like '%@example.com'`)
    console.log(`✔ Repaired ${res.rowCount} demo accounts. Try signing in again.`)
  },
}

if (!commands[command]) {
  fail(`Unknown command "${command ?? ''}". Use one of: ${Object.keys(commands).join(', ')}`)
}
await withClient(commands[command])
