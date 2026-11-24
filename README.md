# BeautyExpress

A two-sided marketplace for booking hairstylists — like ordering a ride, but for a silk press, knotless braids or a loc retwist. Clients find freelance and salon stylists, see real prices and free times, book, pay and review. Stylists manage their profile, services, hours, bookings and payouts. Administrators run the platform.

> **Status: working application, not yet production-ready.** The database, booking engine, security rules and user interface are built and tested (see [What works and what is verified](#what-works-and-what-is-verified)). Stripe, email, SMS and maps have been built but **not yet tested against the real providers**, because that needs your own accounts. Follow [DEPLOYMENT.md](DEPLOYMENT.md) and its go-live checklist before taking real bookings.

---

## Contents

1. [How it works (big picture)](#how-it-works-big-picture)
2. [Run it on your computer](#run-it-on-your-computer)
3. [Demo accounts](#demo-accounts)
4. [Project structure](#project-structure)
5. [Accounts and keys you need](#accounts-and-keys-you-need)
6. [What works and what is verified](#what-works-and-what-is-verified)
7. [Known limitations and decisions you need to make](#known-limitations-and-decisions-you-need-to-make)
8. [Changing the name, colours and logo](#changing-the-name-colours-and-logo)

Other guides: [DEPLOYMENT.md](DEPLOYMENT.md) · [DATABASE.md](DATABASE.md) · [SECURITY.md](SECURITY.md) · [TESTING.md](TESTING.md)

---

## How it works (big picture)

```
 Browser (React + Vite + Tailwind)            Supabase                             Other services
 ┌──────────────────────────────┐   anon key  ┌─────────────────────────────────┐   ┌──────────────┐
 │ Pages, forms, Stripe card    │ ──────────► │ PostgreSQL + Row Level Security │   │ Stripe       │
 │ field (Stripe.js)            │             │ Auth (sign-up, sign-in, reset)  │   │ (payments,   │
 │                              │ ◄────────── │ Storage (photos)                │   │  Connect)    │
 │ No secrets in here.          │  realtime   │ Realtime (messages, updates)    │   ├──────────────┤
 └──────────────────────────────┘             │ Edge Functions (Deno) ──────────┼──►│ Resend email │
                                              │   hold the secret keys          │   │ Twilio SMS   │
                                              └─────────────────────────────────┘   └──────────────┘
```

**The most important design rule:** the browser is never trusted with anything that matters. Prices, availability, booking statuses, refunds and permissions are all decided **inside the database**:

- **Row Level Security (RLS)** decides who can read or change each row. A client simply cannot read another client's address, even by calling the API directly.
- **Database functions** such as `create_booking`, `quote_booking`, `transition_booking` and `cancel_booking` do all the business logic in one transaction.
- **A database constraint** (`no_double_booking`) makes it physically impossible to store two overlapping active bookings for the same stylist, even if two people click "Book" at the same millisecond.
- **Edge Functions** (small server programs) hold the Stripe secret key and talk to Stripe. Stripe's webhook tells the server when a payment succeeds; only then is a booking confirmed.

### The booking journey

1. Client picks a stylist and a service, chooses options (length, add-ons), where (salon, studio or at home) and a free time.
2. The database calculates the price (`quote_booking`) and shows an itemised breakdown.
3. `create_booking` re-checks everything — the slot, the options, the address, the price — and saves the booking.
   - Card payment on: status **Awaiting payment**, the slot is held for 15 minutes while the client pays with Stripe.
   - Pay in person or e-Transfer: goes straight to **Requested** or **Confirmed**.
4. The stylist is notified, and accepts or declines (unless the service books instantly).
5. Stylist marks **In progress**, then **Completed**.
6. After a 24-hour hold with no dispute, the stylist's share is transferred to their Stripe account.
7. The client gets a review reminder.

---

## Run it on your computer

> **No Docker? (common on Windows laptops)** Follow **[SETUP-WITHOUT-DOCKER.md](SETUP-WITHOUT-DOCKER.md)** instead: it uses a free online Supabase project and needs only Node.js.

You need: **Node.js 20.19+** (22 recommended, see `.nvmrc`), **Git**, **Docker Desktop** and the **Supabase CLI**. Install links and exact steps are in [DEPLOYMENT.md § 1](DEPLOYMENT.md#1-install-the-tools).

```bash
# 1. Get the code and install dependencies
cd beautyexpress
npm install

# 2. Start a local Supabase (database, auth, storage) — needs Docker running
npx supabase start          # first time downloads images; prints URLs and keys
npx supabase db reset       # creates all tables and loads the fictional demo data

# 3. Tell the website where Supabase is
cp .env.example .env        # Windows: copy .env.example .env
#    open .env and paste the "API URL" and "anon key" that `supabase start` printed

# 4. Start the website
npm run dev                 # open http://localhost:5173
```

That is enough to browse, sign up, book (pay in person), message, review and use the stylist and admin dashboards. To try card payments locally, follow [DEPLOYMENT.md § 10–11](DEPLOYMENT.md#10-configure-stripe-test-mode).

**Emails while developing:** password-reset and confirmation emails are caught by Supabase's local inbox at <http://localhost:54324>.

**If you see an "Almost there" page:** your `.env` file is missing or the variable names are wrong. Stop the server (Ctrl + C), fix `.env`, run `npm run dev` again.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the website with live reload |
| `npm run build` | Create the production build in `dist/` |
| `npm run lint` | Check code style and common mistakes |
| `npm test` | Unit and component tests |
| `npm run test:db` | Database, security (RLS) and booking tests — needs `TEST_DATABASE_URL` |
| `npm run test:functions` | Edge Function tests (Stripe webhook etc.) — needs Deno |
| `npm run test:e2e` | Browser tests with Playwright |
| `npx supabase db reset` | Rebuild the local database from migrations + seed |

---

## Demo accounts

All demo data is **fictional** (people, salons, addresses, reviews) and exists only after `supabase db reset` loads `supabase/seed.sql`. Never load the seed into production. Password for every account: **`Password123!`**

| Email | Role |
|---|---|
| `admin@example.com` | Administrator (and client) |
| `client1@example.com` | Client with a saved address, past and upcoming bookings |
| `client2@example.com` | Client with a pending request |
| `stylist1@example.com` | Freelance braider, instant booking, mobile + studio |
| `stylist2@example.com` | Salon stylist, approves each request |
| `stylist3@example.com` – `stylist5@example.com` | More stylists in Moncton, Halifax and Saint John |
| `stylist6@example.com` | Stylist who has not finished onboarding (hidden from search) |

Promo code for testing: `WELCOME10` (10% off).

---

## Project structure

```
beautyexpress/
├── public/                     favicon and original SVG illustrations (replace with your own photos)
├── src/
│   ├── App.jsx                 every page and its address (route)
│   ├── main.jsx                app start-up
│   ├── config/brand.js         app name, support email, legal name
│   ├── styles/index.css        colours, fonts and shared styles (Tailwind)
│   ├── contexts/               who is signed in (AuthContext), toast messages
│   ├── hooks/                  useAsync (loading/error state), unread counts, page titles
│   ├── lib/                    supabase client, stripe, maps, pricing, availability, validation
│   ├── services/               ALL database/API calls, grouped by topic
│   ├── components/             reusable UI: common, forms, navigation, bookings, stylists, services
│   ├── layouts/                public, dashboard and sign-in page frames
│   ├── pages/
│   │   ├── public/             home, explore/search, categories, stylist, service, legal…
│   │   ├── auth/               sign in/up, password reset, onboarding wizard
│   │   ├── client/             dashboard, checkout, bookings, payments, reviews, support…
│   │   ├── stylist/            dashboard, profile, portfolio, services, availability, earnings…
│   │   ├── admin/              overview, users, stylists, bookings, transactions, reports…
│   │   └── shared/             booking detail, confirmation, receipt, messages, notifications
│   └── utils/
├── supabase/
│   ├── config.toml             local Supabase settings
│   ├── migrations/             the database, in order (tables → helpers → security → logic)
│   ├── seed.sql                fictional demo data (development only)
│   └── functions/              Edge Functions (server code with secret keys)
│       ├── _shared/            shared helpers: HTTP, Supabase clients, Stripe, refunds, webhook logic
│       ├── create-payment-intent/   starts a card payment for the amount the DB says is due
│       ├── stripe-webhook/          receives verified Stripe events
│       ├── cancel-booking/          cancel/decline + immediate Stripe refund
│       ├── process-refund/          admin/scheduled refund processing
│       ├── stripe-connect/          stylist payout account onboarding
│       ├── release-payouts/         transfers stylists' earnings (scheduled)
│       ├── send-notification/       reminders, emails, SMS (scheduled)
│       └── tests/                   Deno tests
├── tests/
│   ├── unit/                   Vitest: pricing, statuses, validation, components, route guards
│   ├── integration/            Vitest + PostgreSQL: RLS, bookings, payments, price parity
│   ├── e2e/                    Playwright browser tests
│   └── db/supabase-stub.sql    lets DB tests run on plain PostgreSQL
├── .env.example                frontend settings template (public keys only)
├── vercel.json                 hosting config (single-page routing, security headers)
└── README / DEPLOYMENT / DATABASE / SECURITY / TESTING .md
```

There is no `create-booking` Edge Function on purpose: booking is done by the `create_booking` **database** function, which is atomic, enforces RLS and is fully tested. A separate server hop would add a failure point without adding security. Likewise there are no `tailwind.config.js`/`postcss.config.js` files: Tailwind CSS v4 is configured in `src/styles/index.css` via the Vite plugin.

---

## Accounts and keys you need

| Service | Needed for | Required? | Where the key goes |
|---|---|---|---|
| **Supabase** | Database, auth, storage, functions | Yes | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env` / Vercel |
| **Vercel** | Hosting the website | Yes (or any static host) | — |
| **GitHub** | Storing your code, deploying to Vercel | Recommended | — |
| **Stripe** (with Connect) | Card payments, refunds, stylist payouts | For online payments | `VITE_STRIPE_PUBLISHABLE_KEY` (website); `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (function secrets) |
| **Resend** | Email notifications | Optional | `RESEND_API_KEY`, `EMAIL_FROM` (function secrets) |
| **Twilio** | SMS | Optional | `TWILIO_*` (function secrets) |
| **Mapbox or Google Maps** | Address → coordinates for accurate travel fees | Optional | `VITE_MAPS_PROVIDER` + token (website) |
| **A domain name** | Your own web address | For launch | Vercel + Supabase Auth settings |

The app works without the optional ones: payments default to "pay in person", emails/SMS are skipped (in-app notifications still work), and locations use a built-in list of Canadian cities.

---

## What works and what is verified

"Verified" means an automated test ran and passed in the build environment on 12 Oct 2026 (see [TESTING.md](TESTING.md) for the exact results). "Built, not verified" means the code is complete and type-checked but has not been run against the real external service.

### Verified by automated tests

| Area | Tests |
|---|---|
| Database schema, all 7 migrations and seed apply cleanly | DB tests (PostgreSQL 16) |
| Row Level Security: anonymous, client, stylist and admin access to every sensitive table | `tests/integration/rls.test.js` |
| Users cannot make themselves admin; admin rights lost when suspended | RLS tests |
| Price calculation (options, promos, travel fee, booking fee, tax, commission, deposits) | unit + DB tests; **JS and SQL formulas proven identical** |
| Availability: working hours, breaks, time off, notice period, buffer time | DB tests |
| **Double-booking prevention**, including two simultaneous requests for one slot | DB tests |
| Booking creation, status transitions and who may perform them | DB tests |
| Cancellation rules: free window, late fee, stylist/admin full refund | DB tests |
| Rescheduling, review eligibility (once, completed, within 30 days, own booking) | DB tests |
| Payment state machine: hold, success, duplicate webhook, failure, expiry, late payment | DB tests (Stripe simulated) |
| Refund maths (never more than paid, applied exactly once) | DB + Deno tests |
| Stripe webhook signature verification, replay protection, duplicate events | Deno tests (real Stripe SDK, no network) |
| PaymentIntent idempotency and re-use; refund idempotency keys | Deno tests |
| Payouts: hold period, dispute blocks payout, one payout per booking | DB tests |
| Manual e-Transfer flow and admin verification | DB tests |
| Messaging privacy, notifications privacy | DB tests |
| Admin functions refuse non-admins; settings validated; changes audited | DB tests |
| Search by category, location, mode, text and price | DB tests |
| UI: route guards, forms, price display, cards; public pages, search flow, sign-in redirect, mobile menu | Vitest + Playwright (desktop and mobile) |
| Production build and lint | `npm run build`, `npm run lint` |

### Built, not yet verified against the real provider

- Stripe test-mode checkout in the browser (Payment Element), real webhooks, real refunds
- Stripe Connect onboarding, Express dashboard links and transfers
- Supabase Auth emails (confirmation, reset) on a hosted project
- Supabase Storage uploads (avatars, portfolio) and Realtime on a hosted project
- Resend email and Twilio SMS sending
- Mapbox / Google geocoding
- Scheduled jobs (pg_cron) calling the Edge Functions
- Signed-in screens end-to-end in a browser (they are covered by build, lint and database tests, but the full click-through needs a running Supabase — see [TESTING.md](TESTING.md#manual-test-script))

---

## Known limitations and decisions you need to make

These need a business, legal or financial decision — the app does not guess:

1. **Tax.** `tax_percent` is 0 by default. Whether HST/GST applies, who registers and remits (platform vs. each stylist), and how it appears on receipts depends on your structure. Get advice from a Canadian accountant, then set the rate in Admin › Platform settings and add your tax numbers to the receipt page.
2. **Who is the "merchant of record".** The app uses Stripe **separate charges and transfers**: the client pays the platform, which later transfers the stylist's share. This lets the platform hold funds until the appointment is done, but it means the platform is responsible for refunds and disputes. Stripe requires the platform and stylists to be in supported countries (Canada ↔ Canada works). Confirm with Stripe that your business model is supported.
3. **Interac e-Transfer** is a **manual** workflow: the client sends money to your business email with a reference code, and an admin confirms receipt before marking it paid. It is not automated or verified by Stripe. Off by default.
4. **Pay in person** means the platform cannot collect its commission automatically. Use it for early testing, or decide how you will invoice stylists for commission.
5. **Promo codes** reduce the service price; commission is calculated on the discounted price, so stylist and platform share the discount. Change `quote_booking` if you want platform-funded discounts.
6. **Disputes after payout:** if a dispute is resolved after the stylist was paid, the refund must be recovered by reversing the transfer in Stripe (the admin screen warns about this).
7. **Salon membership** is self-declared: any stylist can link themselves to a listed salon. Add salon-owner approval before relying on salon affiliation for trust.
8. **Distance** uses the stylist's approximate (1 km) location and a straight-line distance, not driving distance. For large launches, consider PostGIS and a routing API.
9. **Legal pages** are templates and are clearly marked. A lawyer must review them.
10. **Photos:** the demo uses original abstract illustrations, not hairstyle photography. Upload real photos you own or have permission to use.
11. **Account deletion** is handled by support (on request) rather than self-service, to keep booking and payment records required for tax and disputes.

---

## Changing the name, colours and logo

- **Name, support email, legal name:** `.env` (`VITE_APP_NAME`, …) or `src/config/brand.js`.
- **Colours and fonts:** the `@theme` block at the top of `src/styles/index.css`. Fonts are loaded in `index.html`.
- **Logo:** `src/components/navigation/Logo.jsx` (text logo) and `public/favicon.svg`.
- **Email look:** `supabase/functions/send-notification/index.ts` (`emailHtml`).
#   B e a u t y E x p r e s s  
 