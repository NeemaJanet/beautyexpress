# Testing

## Test suites

| Suite | Tool | Command | What it covers |
|---|---|---|---|
| Unit and component | Vitest + Testing Library | `npm test` | Price formula, money helpers, booking status rules, availability helpers, validation, open-redirect guard, route guards, UI components |
| Database and security | Vitest + real PostgreSQL | `npm run test:db` | Every migration and the seed; Row Level Security for anonymous, client, stylist and admin users; booking engine; double-booking (including a race); cancellations, refunds, payouts, e-Transfer; reviews; messaging; admin functions; search; **JS vs SQL price parity** |
| Edge Functions | Deno | `npm run test:functions` | Stripe webhook signature/replay checks with the real Stripe SDK, duplicate events, event→database mapping, PaymentIntent creation and re-use, refund idempotency |
| Edge Function types | Deno | `npm run check:functions` | Type-checks all seven functions |
| Browser | Playwright | `npm run test:e2e` | Home search sentence, explore filters, stylist profile, sign-in redirect for booking, form validation, protected routes, legal and 404 pages, mobile menu — desktop and mobile viewports |
| Lint / build | ESLint, Vite | `npm run lint`, `npm run build` | Code problems, React hook rules, every import resolves |

`npm run test:all` runs lint, unit, database, function tests and the build.

## Results of the last run (12 October 2026, build environment)

| Suite | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` | **42 passed** (6 files) |
| `npm run test:db` | **87 passed** (4 files) on PostgreSQL 16.15 with `tests/db/supabase-stub.sql` |
| `npm run check:functions` | All 7 functions type-check (Deno 2.9) |
| `npm run test:functions` | **16 passed** |
| `npm run test:e2e` | **15 passed**, 1 skipped (mobile-only test on desktop) — Chrome 141 |
| `npm run build` | Success |

Not run in that environment (needs real accounts/services): Stripe test-mode payments end to end, Stripe Connect onboarding, hosted Supabase Auth emails, Storage uploads, Realtime, Resend, Twilio, Mapbox/Google, pg_cron. Use the manual script below and DEPLOYMENT.md § 11.

## Running the database tests

They need an **admin** connection to a PostgreSQL server. Each test file creates and drops its own temporary database, so your data is safe.

With the local Supabase stack (`npx supabase start`):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

On Windows PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"; npm run test:db
```

Any PostgreSQL 15+ works too (the helper loads `tests/db/supabase-stub.sql`, which mimics Supabase's `auth` schema and roles). Without `TEST_DATABASE_URL`, the database tests are skipped, not failed.

The tests switch identity exactly like Supabase does: `set role authenticated` plus JWT claims, so RLS is evaluated for real.

## Running the Edge Function tests

Install Deno, then `npm run test:functions`. No network access to Stripe is needed: signatures are generated and verified locally with the real Stripe SDK.

## Running the browser tests

```bash
npx playwright install chromium
npm run test:e2e
```

They start the dev server on port 5199 and mock the Supabase API at the network level (`tests/e2e/mockSupabase.js`), so no backend is required. To use an existing Chrome instead of downloading one: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Manual test script

Run against local Supabase (`npx supabase db reset` first) or staging. Tick each item.

**Client**
- [ ] Sign up as a client → onboarding → lands on Explore.
- [ ] Search “cornrows” near Fredericton, filter “Stylist comes to me”, sort by distance.
- [ ] Open Amara Demo → Save → appears in Favourites → Message → conversation opens.
- [ ] Book “Straight-back cornrows” at your location: add an address, see travel fee in the breakdown, pick a time, confirm (pay in person) → confirmation page.
- [ ] Booking page shows the address and status *Confirmed*; receipt prints.
- [ ] Reschedule to another time; cancel → appears under Cancelled.
- [ ] Try `WELCOME10` promo; try an invalid code (error shown, price unchanged).
- [ ] Profile: change name, upload a photo, change password; reset password from the sign-in page (email in <http://localhost:54324>).
- [ ] Support: create a request; admin replies; reply visible.

**Stylist**
- [ ] Sign in as `stylist3@example.com`: the seeded request from client2 is waiting on the dashboard → Accept → client2 gets a notification.
- [ ] Services: add a service with a “Length” choose-one group; check the earnings preview.
- [ ] Availability: add a break and a day off → that day shows no free times on the booking page.
- [ ] Portfolio: upload, caption, reorder, delete.
- [ ] Start and complete an appointment (an admin can bypass the time rule for testing) → client can review → reply to the review.
- [ ] New stylist sign-up: publish is refused until a service and hours exist.

**Admin** (`admin@example.com`)
- [ ] Overview numbers match; Needs attention links work.
- [ ] Suspend client2 → client2 sees the suspended banner and cannot book; reactivate.
- [ ] Approve/verify/feature a stylist; turn on *require stylist approval* and confirm pending stylists disappear from search.
- [ ] Change the booking fee → new quotes change; audit log shows the change with before/after.
- [ ] Turn on manual e-Transfer, book with it as a client, mark sent, verify as admin.
- [ ] Resolve a dispute with a partial refund.

**Payments (Stripe test mode)** — follow DEPLOYMENT.md § 11 steps 1–8.

**Security spot checks (browser console on the live site, signed in as a client)**

```js
// each of these must fail or return nothing
await supabase.from('user_roles').insert({ user_id: (await supabase.auth.getUser()).data.user.id, role: 'admin' })
await supabase.from('bookings').update({ total_cents: 1 }).neq('id', '00000000-0000-0000-0000-000000000000')
await supabase.from('addresses').select('*')          // only your own
await supabase.rpc('admin_stats')                      // "Administrator access required."
```

(`supabase` is not exposed globally by the app; paste `const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')` and create a client with the public URL and anon key, then sign in, to run these.)
