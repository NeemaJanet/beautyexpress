import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, PaymentBadge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { FormError } from '../../components/common/Field.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { EmptyState, LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../lib/availability.js'
import { formatMoney } from '../../lib/pricing.js'
import { supabase, unwrap } from '../../lib/supabase.js'
import { getPublicSettings } from '../../services/catalogService.js'
import { listStylistPayouts, stripeConnect } from '../../services/paymentService.js'
import { getMyStylistPrivate } from '../../services/stylistService.js'

export default function EarningsPage() {
  useDocumentTitle('Earnings and payouts')
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const priv = useAsync(() => getMyStylistPrivate(user.id), [user.id])
  const settings = useAsync(getPublicSettings, [])
  const payouts = useAsync(() => listStylistPayouts(user.id), [user.id])
  const completed = useAsync(
    async () =>
      unwrap(
        await supabase
          .from('bookings')
          .select('id, reference, starts_at, completed_at, total_cents, stylist_earnings_cents, platform_commission_cents, service_fee_cents, payment_provider, currency, stylist_services(title)')
          .eq('stylist_id', user.id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(100),
      ),
    [user.id],
  )
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  // Returning from Stripe onboarding: refresh the account status.
  const stripeReturn = params.get('stripe')
  const reloadPriv = priv.reload
  useEffect(() => {
    if (!stripeReturn) return
    stripeConnect('refresh')
      .catch(() => {})
      .finally(() => {
        reloadPriv()
        setParams({}, { replace: true })
      })
  }, [stripeReturn, reloadPriv, setParams])

  const connect = async (action) => {
    setBusy(action)
    setError(null)
    try {
      const r = await stripeConnect(action)
      if (r.url) window.location.assign(r.url)
      else priv.reload()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  if (priv.loading || completed.loading) return <LoadingState />
  const p = priv.data
  const rows = completed.data || []
  const total = rows.reduce((s, b) => s + b.stylist_earnings_cents, 0)
  const thisMonth = rows.filter((b) => new Date(b.completed_at).getMonth() === new Date().getMonth() && new Date(b.completed_at).getFullYear() === new Date().getFullYear())
  const transferred = (payouts.data || []).filter((x) => x.status === 'transferred').reduce((s, x) => s + x.amount_cents, 0)
  const onlinePaymentsOn = settings.data?.online_payments_enabled

  return (
    <div className="space-y-8">
      <PageHeader title="Earnings and payouts" />

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-5"><p className="text-sm text-stone">This month</p><p className="mt-1 font-display text-3xl">{formatMoney(thisMonth.reduce((s, b) => s + b.stylist_earnings_cents, 0))}</p></div>
        <div className="panel p-5"><p className="text-sm text-stone">All completed bookings</p><p className="mt-1 font-display text-3xl">{formatMoney(total)}</p></div>
        <div className="panel p-5"><p className="text-sm text-stone">Sent to your Stripe account</p><p className="mt-1 font-display text-3xl">{formatMoney(transferred)}</p></div>
      </section>

      <section className="panel p-6">
        <SectionTitle>Payout account</SectionTitle>
        {!onlinePaymentsOn ? (
          <p className="text-sm text-stone">Online card payments are not switched on yet. Clients currently pay you directly at appointments.</p>
        ) : p.stripe_payouts_enabled ? (
          <div className="space-y-3">
            <Badge tone="green">Payouts active</Badge>
            <p className="text-sm text-stone">Earnings are sent to your Stripe account {settings.data?.payout_hold_hours ?? 24} hours after each completed appointment, then to your bank on Stripe’s schedule.</p>
            <Button variant="secondary" onClick={() => connect('dashboard')} loading={busy === 'dashboard'}>Open Stripe dashboard</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {p.stripe_account_id ? <Badge tone="amber">Setup incomplete</Badge> : <Badge>Not set up</Badge>}
            <p className="text-sm text-stone">
              BeautyExpress uses Stripe to send your earnings to your bank account. Stripe will ask for your identity and banking details — BeautyExpress never sees them.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => connect('onboard')} loading={busy === 'onboard'}>{p.stripe_account_id ? 'Continue setup' : 'Set up payouts'}</Button>
              {p.stripe_account_id && <Button variant="ghost" onClick={() => connect('refresh')} loading={busy === 'refresh'}>Check status</Button>}
            </div>
          </div>
        )}
        <div className="mt-3"><FormError error={error} /></div>
      </section>

      <section>
        <SectionTitle>Payouts</SectionTitle>
        {!payouts.data?.length ? (
          <p className="text-stone">No payouts yet.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-[var(--radius-panel)] border border-sand bg-paper text-sm">
            {payouts.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>{formatDate(x.created_at)}, {x.bookings?.stylist_services?.title} ({x.bookings?.reference})</span>
                <PaymentBadge status={x.status} />
                <span className="font-medium">{formatMoney(x.amount_cents, x.currency)}</span>
                {x.failure_reason && <span className="w-full text-xs text-danger">{x.failure_reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Completed appointments</SectionTitle>
        {!rows.length ? (
          <EmptyState title="No completed appointments yet" />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-sand bg-paper">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-sand text-left text-stone">
                <tr>
                  <th className="px-4 py-3 font-normal">Date</th>
                  <th className="px-4 py-3 font-normal">Service</th>
                  <th className="px-4 py-3 text-right font-normal">Client paid</th>
                  <th className="px-4 py-3 text-right font-normal">Commission</th>
                  <th className="px-4 py-3 text-right font-normal">You earn</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-sand/60 last:border-0">
                    <td className="px-4 py-3">{formatDate(b.starts_at)}</td>
                    <td className="px-4 py-3"><Link className="hover:text-brown" to={`/bookings/${b.id}`}>{b.stylist_services?.title}</Link></td>
                    <td className="px-4 py-3 text-right">{formatMoney(b.total_cents, b.currency)}</td>
                    <td className="px-4 py-3 text-right text-stone">−{formatMoney(b.platform_commission_cents, b.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatMoney(b.stylist_earnings_cents, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-stone">
          For pay-in-person bookings you collect the full amount yourself; commission on those is invoiced separately by BeautyExpress.
        </p>
      </section>
    </div>
  )
}
