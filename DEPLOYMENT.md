# Deployment guide

Step-by-step, from an empty computer to a live site. Do the steps in order. Commands are typed in a terminal (macOS: Terminal; Windows: PowerShell) inside the `beautyexpress` folder unless stated otherwise.

**Golden rule:** secret keys (Stripe `sk_…`, `whsec_…`, Supabase `service_role`, Resend, Twilio, the cron secret) go **only** into Supabase Edge Function secrets. They never go into `.env`, Vercel, or Git. Only `VITE_…` public values go into the website.

---

## 1. Install the tools

| Tool | Why | How |
|---|---|---|
| Node.js 22 LTS | Runs the build and dev server | <https://nodejs.org> (or `nvm install` — the version is in `.nvmrc`) |
| Git | Version control | <https://git-scm.com> |
| Docker Desktop | Runs Supabase locally | <https://www.docker.com/products/docker-desktop> |
| Supabase CLI | Database migrations, functions | Use it through npx: `npx supabase --version` (no install needed) |
| Stripe CLI | Forward test webhooks to your computer | <https://docs.stripe.com/stripe-cli> |
| Deno (optional) | Run Edge Function tests | <https://deno.com> |

Check: `node -v` (20.19 or newer), `git --version`, `docker --version`.

## 2. The React application

The application is already created (React + Vite + Tailwind CSS v4). You do not need to run `npm create vite`. If you ever want to see how it was created: `npm create vite@latest beautyexpress -- --template react`, then the dependencies below were added.

## 3. Install dependencies

```bash
npm install
```

This reads `package.json` and `package-lock.json` and installs exactly the tested versions.

## 4. Create a Supabase project

1. Sign up at <https://supabase.com> and create a **new project**. Choose the region closest to your users (e.g. *Canada (Central)*), and save the database password in a password manager.
2. In the dashboard open **Project Settings › API** and note:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → secret; you will not paste it anywhere in this project (Supabase gives it to functions automatically).
   - **Project ref** (the `xxxx` in `https://xxxx.supabase.co`).
3. Link your folder to the project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Create **two** projects if you can — `beautyexpress-staging` for testing and `beautyexpress-prod` for real customers — and run every step on staging first.

## 5. Configure environment variables

**Website (local):** `cp .env.example .env` and fill in the values. For a hosted project use its URL and anon key.

**Website (production):** add the same `VITE_…` variables in Vercel (step 14). See `.env.production.example`.

**Server secrets:** copy `supabase/functions/.env.example` to a file **outside** the repository or to `supabase/functions/.env` (git-ignored), fill it in, then:

```bash
npx supabase secrets set --env-file supabase/functions/.env
npx supabase secrets list     # shows names only, never values
```

Generate the cron secret with `openssl rand -hex 32` (or any password generator, 40+ characters).

## 6. Apply the database migrations

```bash
npx supabase db push
```

This runs every file in `supabase/migrations/` in order: tables → helpers and triggers → Row Level Security → booking logic → payments → messaging/admin/search → storage, realtime and permissions. Run it again whenever you add a migration. **Never edit a migration that has already run in production — add a new one.**

Locally, `npx supabase db reset` recreates everything from scratch.

## 7. Load seed data (development and staging only)

Locally `supabase db reset` loads `supabase/seed.sql` automatically. For a hosted **staging** project you can paste `supabase/seed.sql` into **SQL Editor** and run it.

**Do not run the seed in production.** It creates accounts with a known password.

### Create your first real administrator (production)

1. Sign up on your live site with your own email.
2. In Supabase **SQL Editor** run (with your email):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@yourdomain.ca'
on conflict do nothing;
```

3. Sign out and back in. You will see **Admin** in the account menu. After that, grant admin to others from **Admin › Users** (it is logged in the audit log).

## 8. Configure Supabase Auth and redirect URLs

Dashboard › **Authentication**:

- **URL Configuration › Site URL:** `https://yourdomain.ca` (local: `http://localhost:5173`)
- **Redirect URLs:** add `https://yourdomain.ca/**`, your Vercel preview pattern (e.g. `https://beautyexpress-*.vercel.app/**`), and `http://localhost:5173/**` on staging.
- **Providers › Email:** enable *Confirm email* in production. Minimum password length 8.
- **Emails › SMTP:** for production, set a custom SMTP (e.g. Resend SMTP) — Supabase's built-in email has very low rate limits and is for testing only.
- **Rate limits:** keep the defaults or lower them.
- **Attack protection:** enable CAPTCHA (hCaptcha/Turnstile) before launch if you see sign-up abuse. (The frontend would need the CAPTCHA widget added — not included yet.)

## 9. Deploy the Edge Functions

```bash
npx supabase functions deploy create-payment-intent
npx supabase functions deploy cancel-booking
npx supabase functions deploy stripe-connect
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy process-refund --no-verify-jwt
npx supabase functions deploy release-payouts --no-verify-jwt
npx supabase functions deploy send-notification --no-verify-jwt
```

Why `--no-verify-jwt` on four of them: Stripe and the scheduler cannot send a Supabase login token. Each of those functions checks its own security instead — the Stripe signature, or the `x-cron-secret` header / an admin session.

### Schedule the background jobs

In **Database › Extensions** enable `pg_cron` and `pg_net`. Then in **SQL Editor** (replace the ref and secret):

```sql
-- Store the cron secret in Supabase Vault (encrypted)
select vault.create_secret('PASTE-THE-SAME-CRON_SECRET', 'beautyexpress_cron_secret');

-- Every 5 minutes: release expired holds, create reminders, send emails/SMS
select cron.schedule('beautyexpress-notifications', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'beautyexpress_cron_secret')),
    body := '{}'::jsonb);
$$);

-- Every 15 minutes: retry any refunds that did not reach Stripe
select cron.schedule('beautyexpress-refunds', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-refund',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'beautyexpress_cron_secret')),
    body := '{}'::jsonb);
$$);

-- Every hour: pay stylists for bookings past the hold period
select cron.schedule('beautyexpress-payouts', '7 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/release-payouts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'beautyexpress_cron_secret')),
    body := '{}'::jsonb);
$$);
```

Check runs with `select * from cron.job_run_details order by start_time desc limit 20;`. Admins can also trigger the notification and payout jobs from the **Admin overview**.

## 10. Configure Stripe test mode

1. Create a Stripe account at <https://stripe.com>. Stay in **Test mode** (toggle at the top).
2. **Developers › API keys:** copy the *Publishable key* (`pk_test_…`) to `VITE_STRIPE_PUBLISHABLE_KEY`, and the *Secret key* (`sk_test_…`) to the `STRIPE_SECRET_KEY` function secret.
3. **Connect:** open *Connect* in the dashboard and complete the platform profile. Choose **Express** accounts and the **platform handles pricing / separate charges and transfers** model. Set your branding (shown during stylist onboarding).
4. **Settings › Payment methods:** enable the methods you want (cards at minimum). The app uses Stripe's automatic payment methods.
5. Set `APP_URL` (function secret) to your site address — Stripe returns stylists there after onboarding.
6. In the app: **Admin › Platform settings › online payments enabled → On.** (The switch refuses to turn on if the publishable key is missing.)

## 11. Set up and verify Stripe webhooks

**Hosted:** Stripe Dashboard › Developers › **Webhooks** › *Add endpoint*

- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.processing`, `refund.created`, `refund.updated`, `refund.failed`, `transfer.reversed`
- Copy the **Signing secret** (`whsec_…`) to `STRIPE_WEBHOOK_SECRET` and run `npx supabase secrets set …` again.
- Add a **second endpoint** with *Listen to: Events on connected accounts* for `account.updated`, same URL; put its signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.

**Local:**

```bash
npx supabase functions serve --env-file supabase/functions/.env
stripe login
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
# copy the whsec_… it prints into supabase/functions/.env, restart `functions serve`
```

**Verify:**

1. Book a service while signed in as a client and pay with card `4242 4242 4242 4242`, any future date, any CVC.
2. The booking page shows "Confirming your booking…" then the confirmation page.
3. In Stripe › Webhooks the event shows **200**. In Supabase, `select id, type, processed_at, last_error from stripe_events order by received_at desc;` shows it processed.
4. Re-send the same event from the Stripe dashboard: the response says `duplicate` and nothing changes.
5. Cancel the booking as the stylist: the refund appears in Stripe and the booking shows *Refund issued*.
6. Try card `4000 0000 0000 9995` (insufficient funds): the client sees the error and the booking stays *Awaiting payment*.
7. As a stylist, **Earnings › Set up payouts** opens Stripe's onboarding; use Stripe's test data. Back in the app, status becomes *Payouts active*.
8. Complete a paid booking, then (to skip the 24 h wait while testing) set `payout_hold_hours` to 0 and press **Release due payouts** in the admin overview. The transfer appears in Stripe › Connect.

Record what you tested — "built, not verified" items in the README become verified only after this.

## 12. Run the application locally

```bash
npx supabase start
npm run dev
```

Open <http://localhost:5173>. Stop Supabase with `npx supabase stop`.

## 13. Run the test suite

See [TESTING.md](TESTING.md). Quick version:

```bash
npm run lint
npm test
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
npm run test:functions
npx playwright install chromium && npm run test:e2e
npm run build
```

## 14. Deploy the frontend to Vercel

1. Put the code on GitHub:

```bash
git init            # already done if you received the repository
git add -A
git commit -m "Initial BeautyExpress"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/beautyexpress.git
git push -u origin main
```

2. At <https://vercel.com> › **Add New › Project** › import the repository. Vercel detects Vite (settings are in `vercel.json`).
3. **Settings › Environment Variables:** add every `VITE_…` value from `.env.production.example` for *Production*, and staging values for *Preview*.
4. Deploy. Every push to `main` redeploys automatically; pull requests get preview URLs.

`vercel.json` already sends every page address to `index.html` (so refreshing `/stylists/…` works) and sets security headers (HSTS, no framing, no MIME sniffing).

## 15. Production domain and HTTPS

1. Vercel › Project › **Settings › Domains** › add `yourdomain.ca` and `www.yourdomain.ca`, then create the DNS records Vercel shows at your domain registrar. Vercel issues HTTPS certificates automatically.
2. Update **Supabase Auth Site URL and Redirect URLs** to the new domain (step 8).
3. Update the `APP_URL` and `ALLOWED_ORIGINS` function secrets and redeploy the functions.
4. Update the Stripe webhook URLs only if you use a Supabase custom domain.
5. Restrict your Mapbox/Google key to the new domain.
6. Email: verify your sending domain in Resend (SPF/DKIM DNS records) and set `EMAIL_FROM` to an address on it.

## 16. Switching from test payments to live payments safely

Do **not** switch until every item is checked:

- [ ] All verification steps in § 11 passed on staging and the results are recorded.
- [ ] Lawyer-reviewed Terms, Privacy and Cancellation policy are published.
- [ ] Tax treatment decided with an accountant; `tax_percent` and receipt details set.
- [ ] Stripe account activated (business details, bank account, identity verified); Connect platform profile approved for live mode.
- [ ] Commission, booking fee, cancellation and payout-hold settings reviewed in Admin › Platform settings.
- [ ] Supabase project on a paid plan with **Point-in-Time Recovery** or daily backups, and you have practised a restore on staging.
- [ ] Custom SMTP configured; email confirmation turned on.
- [ ] At least two admins with strong passwords and multi-factor authentication on Supabase, Stripe, Vercel, GitHub and the domain registrar.
- [ ] Monitoring set up (§ 17).

Then:

1. In Stripe switch to **Live mode** and copy the live keys.
2. Create the **live** webhook endpoints (§ 11) — live and test webhooks have different signing secrets.
3. `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…` on the **production** project.
4. Set `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…` in Vercel Production and redeploy.
5. Make one small real booking with your own card, refund it, and confirm both appear correctly in Stripe and the app.
6. Stylists who onboarded in test mode must onboard again in live mode (test accounts do not carry over).

## 17. Monitoring, backups and security

- **Errors:** Supabase › Edge Functions › Logs; Supabase › Logs (API, Postgres, Auth); Vercel › Logs. For alerting, add an error tracker such as Sentry to the frontend (not included).
- **Stripe:** enable email alerts for failed webhooks (Developers › Webhooks) and disputes.
- **Daily admin routine:** Admin overview › *Needs attention* (open disputes, e-Transfers to verify, failed refunds/payouts).
- **Database health:** Supabase › **Advisors** (security and performance) after every migration — fix anything marked ERROR. The `public_profiles` view is intentionally owner-rights (see SECURITY.md).
- **Backups:** paid Supabase plans keep daily backups; enable PITR for production. Download a backup before every risky migration (`npx supabase db dump -f backup.sql`).
- **Keys:** rotate any key you think leaked (Supabase › API › rotate; Stripe › roll key) and update secrets.
- **Dependencies:** run `npm audit` and update monthly; re-run the full test suite after updates.
- **Audit log:** review Admin › Audit log for unexpected role or setting changes.
