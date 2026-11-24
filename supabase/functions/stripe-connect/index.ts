// POST /functions/v1/stripe-connect   { action: 'onboard' | 'refresh' | 'dashboard' }
//
// onboard   -> creates the stylist's Stripe Express account (once) and returns
//              a Stripe-hosted onboarding link.
// refresh   -> re-reads the account from Stripe and stores its status.
// dashboard -> returns a login link to the stylist's Stripe Express dashboard.
import { handler, HttpError, json, requireEnv } from '../_shared/http.ts'
import { stripeClient } from '../_shared/stripe.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

Deno.serve(
  handler(async (req, body) => {
    const action = body.action
    if (!['onboard', 'refresh', 'dashboard'].includes(String(action))) {
      throw new HttpError(400, 'action must be onboard, refresh or dashboard')
    }
    const { user, client } = await requireUser(req)
    const { data: isStylist } = await client.rpc('has_role', { p_role: 'stylist' })
    if (isStylist !== true) throw new HttpError(403, 'Only stylists can set up payouts.')

    const admin = adminClient()
    const stripe = stripeClient()
    const { data: priv, error } = await admin
      .from('stylist_private')
      .select('stripe_account_id')
      .eq('stylist_id', user.id)
      .single()
    if (error) throw new HttpError(404, 'Stylist profile not found.')

    let accountId = priv.stripe_account_id as string | null

    if (action === 'onboard') {
      const appUrl = requireEnv('APP_URL').replace(/\/$/, '')
      if (!accountId) {
        const { data: setting } = await admin
          .from('platform_settings')
          .select('value')
          .eq('key', 'stripe_connect_country')
          .single()
        const account = await stripe.accounts.create(
          {
            type: 'express',
            country: (setting?.value as string) ?? 'CA',
            email: user.email,
            capabilities: { transfers: { requested: true } },
            business_type: 'individual',
            metadata: { stylist_id: user.id },
          },
          { idempotencyKey: `connect-account-${user.id}` },
        )
        const { error: saveErr } = await admin.rpc('svc_set_stripe_account', {
          p_stylist_id: user.id,
          p_account_id: account.id,
        })
        if (saveErr) throw saveErr
        accountId = account.id
      }
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${appUrl}/stylist/earnings?stripe=refresh`,
        return_url: `${appUrl}/stylist/earnings?stripe=return`,
        type: 'account_onboarding',
      })
      return json(req, { url: link.url })
    }

    if (!accountId) throw new HttpError(409, 'Set up payouts first.')

    if (action === 'refresh') {
      const account = await stripe.accounts.retrieve(accountId)
      await admin.rpc('svc_update_connect_account', {
        p_account_id: account.id,
        p_details_submitted: Boolean(account.details_submitted),
        p_charges_enabled: Boolean(account.charges_enabled),
        p_payouts_enabled: Boolean(account.payouts_enabled),
      })
      return json(req, {
        details_submitted: account.details_submitted,
        payouts_enabled: account.payouts_enabled,
        requirements_due: account.requirements?.currently_due ?? [],
      })
    }

    const login = await stripe.accounts.createLoginLink(accountId)
    return json(req, { url: login.url })
  }),
)
