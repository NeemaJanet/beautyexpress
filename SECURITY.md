# Security

## Model in one paragraph

The browser is untrusted. It holds only the Supabase **anon** key and the Stripe **publishable** key, both designed to be public. Every table has Row Level Security; tables that hold money or booking state accept **no direct writes** from users at all — changes go through `SECURITY DEFINER` database functions that check who is calling (`auth.uid()`), validate input and apply business rules inside one transaction. Secret keys live only in Supabase Edge Function secrets. Stripe events are accepted only with a valid signature.

## What is enforced where

| Threat | Protection |
|---|---|
| User makes themselves admin | `user_roles` has no insert/update grant for users; signup trigger only accepts `client`/`stylist`; `admin_set_role` requires admin. Tested. |
| Hidden admin buttons used anyway | Every admin function calls `assert_admin()`; admin RLS policies use `is_admin()`. Suspended admins lose access. Tested. |
| Tampered prices or commission | Browser never sends amounts. `create_booking` recalculates with `quote_booking` from current DB rows; `prepare_payment` decides the Stripe amount. Tested (parity + booking tests). |
| Tampered booking/payment status | No UPDATE grant on `bookings`, `payments`, `refunds`, `payouts`; transitions only through functions with role checks. Tested. |
| Double booking | Exclusion constraint + server slot check. Concurrency tested. |
| Reading others' data | RLS on every table; addresses owner-only; service address visible to the stylist only after confirmation; messages participants-only; studio address via `get_booking_location`. Tested. |
| Stylist inflates own rating / features self | Column-protection trigger. Tested. |
| Stylist sets someone else's Stripe account | Stripe columns writable only by server functions. Tested. |
| Forged Stripe webhook | `constructEventAsync` signature + timestamp check (5-minute tolerance). Tested. |
| Duplicate webhooks / retries | `stripe_events` log + idempotent `svc_*` functions; Stripe idempotency keys on PaymentIntents, refunds, transfers, Connect accounts. Tested. |
| Over-refunding | `queue_refunds` caps at refundable amount; DB check constraint `amount_refunded ≤ amount`. Tested. |
| Spam | Rate limits on bookings, messages, disputes, reports (DB-side); Supabase Auth rate limits. |
| Open redirect after sign-in | `safeNext()` only allows same-site paths. Tested. |
| XSS | React escapes output; no `dangerouslySetInnerHTML`; email template escapes HTML. |
| Clickjacking, MIME sniffing | `vercel.json` security headers. |
| search_path hijacking | Every function sets `search_path = ''` and fully qualifies names. |
| Card data exposure | Card details entered in Stripe's iframe; never stored or seen by BeautyExpress. |
| Location privacy | Public stylist location rounded to ~1 km; home addresses never public. |
| Uploads | Storage policies restrict writes to `<bucket>/<own user id>/…`; buckets limit type (JPG/PNG/WebP) and size. |

## Intentional exceptions (reviewed)

- `public_profiles` view runs with owner rights so it can expose **only** first name + last initial and avatar of published stylists and of people who left visible reviews. The Supabase Advisor flags it as a "security definer view"; this is intended.
- `quote_booking` and `get_available_slots` are callable without signing in so visitors can see prices and times. A side effect is that promo codes can be tested anonymously; keep codes non-guessable or require sign-in by revoking `anon` execute on `quote_booking`.
- `commission_percent`, `service_fee_percent`, `payout_hold_hours`, `etransfer_recipient_email` are public settings (stylists and payers need to see them).

## Known gaps before launch

- No CAPTCHA on sign-up/sign-in (enable in Supabase Auth and add the widget).
- No multi-factor authentication for admin accounts in the app (Supabase supports TOTP MFA; add an MFA enrolment screen and require `aal2` in `is_admin()` for high-value deployments).
- Salon membership is self-declared (no owner approval).
- No automated malware scanning of uploaded images.
- No Content-Security-Policy header yet (needs tuning for Stripe, Supabase and fonts before enabling).
- Penetration test / external security review not done.

## Operational rules

- Never put a secret in a `VITE_` variable, the repository, a screenshot or a support ticket.
- Use separate Supabase and Stripe projects for staging and production.
- Turn on MFA for Supabase, Stripe, Vercel, GitHub, Resend, Twilio and your domain registrar.
- Review the Admin › Audit log weekly and after any incident.
- After adding a database function, explicitly `grant`/`revoke` EXECUTE (Supabase grants it to everyone by default) and run `npm run test:db`.

## Reporting a vulnerability

Email the address in `VITE_SUPPORT_EMAIL` with "SECURITY" in the subject. Do not open public issues for vulnerabilities.
