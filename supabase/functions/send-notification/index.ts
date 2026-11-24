// POST /functions/v1/send-notification   (scheduled job, header x-cron-secret)
//
// Every few minutes this job:
//   1. releases expired payment holds,
//   2. creates 24-hour appointment reminders and review reminders,
//   3. emails in-app notifications that are waiting to be emailed (Resend),
//   4. sends SMS for notifications marked for SMS (Twilio, optional).
//
// In-app notifications work without this job; it only adds email/SMS.
// If RESEND_API_KEY / TWILIO_* are not set, those channels are skipped.
import { handler, HttpError, json } from '../_shared/http.ts'
import { adminClient, isCronRequest, requireAdmin } from '../_shared/supabase.ts'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function emailHtml(title: string, body: string, link: string | null, appUrl: string, appName: string) {
  const button = link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(appUrl + link)}" style="background:#5a3a26;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-family:Arial,sans-serif">Open ${escapeHtml(appName)}</a></p>`
    : ''
  return `<!doctype html><html><body style="background:#f7f3ee;padding:24px;font-family:Arial,sans-serif;color:#2b211c">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e6dcd0">
    <p style="color:#931c63;letter-spacing:2px;font-size:12px;margin:0 0 8px">${escapeHtml(appName.toUpperCase())}</p>
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="line-height:1.6;margin:0">${escapeHtml(body)}</p>${button}
    <p style="color:#6b6058;font-size:12px;margin-top:28px">You can change email preferences in your profile settings.</p>
  </div></body></html>`
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('EMAIL_FROM'), to, subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function sendSms(to: string, body: string): Promise<void> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: Deno.env.get('TWILIO_FROM_NUMBER')!, Body: body.slice(0, 300) }),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}`)
}

Deno.serve(
  handler(async (req) => {
    if (!isCronRequest(req)) await requireAdmin(req)
    const admin = adminClient()
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
    const appName = Deno.env.get('APP_NAME') ?? 'BeautyExpress'
    const emailEnabled = Boolean(Deno.env.get('RESEND_API_KEY') && Deno.env.get('EMAIL_FROM'))
    const smsEnabled = Boolean(
      Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN') && Deno.env.get('TWILIO_FROM_NUMBER'),
    )

    const { data: expired, error: e1 } = await admin.rpc('expire_stale_holds')
    if (e1) throw new HttpError(500, e1.message)
    const { data: reminders, error: e2 } = await admin.rpc('enqueue_due_reminders')
    if (e2) throw new HttpError(500, e2.message)

    const summary = { expired_holds: expired, reminders, emails_sent: 0, emails_failed: 0, sms_sent: 0, skipped: 0 }

    // Email queue
    const { data: queued } = await admin
      .from('notifications')
      .select('id, user_id, title, body, link, profiles(email, email_opt_in)')
      .eq('email_status', 'pending')
      .order('created_at')
      .limit(50)

    for (const n of (queued ?? []) as any[]) {
      const email = n.profiles?.email
      if (!emailEnabled || !email || !n.profiles?.email_opt_in) {
        await admin.from('notifications').update({ email_status: 'skipped' }).eq('id', n.id)
        summary.skipped++
        continue
      }
      try {
        await sendEmail(email, n.title, emailHtml(n.title, n.body, n.link, appUrl, appName))
        await admin.from('notifications').update({ email_status: 'sent' }).eq('id', n.id)
        summary.emails_sent++
      } catch (err) {
        console.error('Email failed', err)
        await admin.from('notifications').update({ email_status: 'failed' }).eq('id', n.id)
        summary.emails_failed++
      }
    }

    // SMS queue
    const { data: smsQueue } = await admin
      .from('notifications')
      .select('id, title, body, profiles(phone, sms_opt_in)')
      .eq('sms_status', 'pending')
      .order('created_at')
      .limit(50)
    for (const n of (smsQueue ?? []) as any[]) {
      if (!smsEnabled || !n.profiles?.phone || !n.profiles?.sms_opt_in) {
        await admin.from('notifications').update({ sms_status: 'skipped' }).eq('id', n.id)
        continue
      }
      try {
        await sendSms(n.profiles.phone, `${appName}: ${n.title}. ${n.body}`)
        await admin.from('notifications').update({ sms_status: 'sent' }).eq('id', n.id)
        summary.sms_sent++
      } catch (err) {
        console.error('SMS failed', err)
        await admin.from('notifications').update({ sms_status: 'failed' }).eq('id', n.id)
      }
    }

    return json(req, summary)
  }),
)
