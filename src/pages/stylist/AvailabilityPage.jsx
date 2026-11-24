import { useState } from 'react'
import { Button } from '../../components/common/Button.jsx'
import { Checkbox, FormError, Input, Select } from '../../components/common/Field.jsx'
import { PageHeader, SectionTitle } from '../../components/common/PageHeader.jsx'
import { LoadingState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime, TIMEZONES, validateWindows, WEEKDAYS } from '../../lib/availability.js'
import { friendlyError } from '../../lib/validation.js'
import { addException, deleteException, listAvailability, listExceptions, replaceDayWindows, updateStylistProfile } from '../../services/stylistService.js'

const trim = (t) => t.slice(0, 5)

export default function AvailabilityPage() {
  useDocumentTitle('Availability')
  const { user, stylistProfile, refresh } = useAuth()
  const toast = useToast()
  const hours = useAsync(() => listAvailability(user.id), [user.id])
  const exceptions = useAsync(() => listExceptions(user.id), [user.id])

  if (hours.loading || !stylistProfile) return <LoadingState />

  return (
    <div className="space-y-8">
      <PageHeader title="Availability" description={`Your weekly hours, breaks and days off. Times are in ${stylistProfile.timezone.replace('America/', '').replace('_', ' ')} time.`} />
      <WeeklyHours userId={user.id} rows={hours.data} onSaved={hours.reload} toast={toast} />
      <TimeOff userId={user.id} rows={exceptions.data || []} reload={exceptions.reload} toast={toast} />
      <BookingRules profile={stylistProfile} userId={user.id} onSaved={refresh} toast={toast} />
    </div>
  )
}

function WeeklyHours({ userId, rows, onSaved, toast }) {
  const [days, setDays] = useState(() =>
    WEEKDAYS.map((_, i) => rows.filter((r) => r.weekday === i).map((r) => ({ start_time: trim(r.start_time), end_time: trim(r.end_time) }))),
  )
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})

  const update = (day, fn) => setDays((d) => d.map((w, i) => (i === day ? fn(w) : w)))

  const save = async () => {
    const errs = {}
    days.forEach((w, i) => {
      const e = validateWindows(w)
      if (e) errs[i] = e
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      for (let i = 0; i < 7; i++) await replaceDayWindows(userId, i, days[i])
      toast.success('Working hours saved')
      onSaved()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-6">
      <SectionTitle action={<Button onClick={save} loading={busy}>Save hours</Button>}>Weekly hours</SectionTitle>
      <p className="mb-4 text-sm text-stone">Add a second time range on a day to create a break (for example 9:00–12:30 and 13:00–18:00).</p>
      <ul className="divide-y divide-sand">
        {WEEKDAYS.map((name, i) => (
          <li key={name} className="grid gap-3 py-4 sm:grid-cols-[140px_1fr]">
            <Checkbox label={name} checked={days[i].length > 0}
              onChange={(e) => update(i, () => (e.target.checked ? [{ start_time: '09:00', end_time: '17:00' }] : []))} />
            <div className="space-y-2">
              {days[i].length === 0 && <p className="text-sm text-stone">Closed</p>}
              {days[i].map((w, j) => (
                <div key={j} className="flex flex-wrap items-center gap-2">
                  <input type="time" className="control w-32" value={w.start_time} aria-label={`${name} start ${j + 1}`}
                    onChange={(e) => update(i, (ws) => ws.map((x, k) => (k === j ? { ...x, start_time: e.target.value } : x)))} />
                  <span className="text-stone">to</span>
                  <input type="time" className="control w-32" value={w.end_time} aria-label={`${name} end ${j + 1}`}
                    onChange={(e) => update(i, (ws) => ws.map((x, k) => (k === j ? { ...x, end_time: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" onClick={() => update(i, (ws) => ws.filter((_, k) => k !== j))} aria-label="Remove time range">Remove</Button>
                </div>
              ))}
              {days[i].length > 0 && (
                <button type="button" className="link text-sm" onClick={() => update(i, (ws) => [...ws, { start_time: ws.at(-1).end_time, end_time: '19:00' }])}>
                  Add another time range
                </button>
              )}
              {errors[i] && <p className="text-sm text-danger">{errors[i]}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TimeOff({ userId, rows, reload, toast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ allDay: true, start: today, end: today, startTime: '09:00', endTime: '17:00', reason: '' })
  const [error, setError] = useState(null)

  const add = async () => {
    const startsAt = f.allDay ? new Date(`${f.start}T00:00`) : new Date(`${f.start}T${f.startTime}`)
    const endsAt = f.allDay ? new Date(new Date(`${f.end}T00:00`).getTime() + 86400000) : new Date(`${f.end}T${f.endTime}`)
    if (!(endsAt > startsAt)) return setError('The end must be after the start.')
    setError(null)
    try {
      await addException({ stylist_id: userId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: f.reason.trim() })
      toast.success('Time off added')
      reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <section className="panel p-6">
      <SectionTitle>Days off and holidays</SectionTitle>
      <p className="mb-4 text-sm text-stone">Clients can’t book during these times. Existing bookings are not cancelled automatically.</p>
      {rows.length > 0 && (
        <ul className="mb-6 divide-y divide-sand rounded-[var(--radius-control)] border border-sand text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>{formatDateTime(r.starts_at)} to {formatDateTime(r.ends_at)}{r.reason && ` (${r.reason})`}</span>
              <Button size="sm" variant="ghost" onClick={async () => { await deleteException(r.id); reload() }}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3">
        <Checkbox label="Whole days" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="From" type="date" min={today} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end })} />
          <Input label="To" type="date" min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          {!f.allDay && (
            <>
              <Input label="Start time" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
              <Input label="End time" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
            </>
          )}
        </div>
        <Input label="Note (only you see this)" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <FormError error={error} />
        <Button variant="secondary" onClick={add}>Add time off</Button>
      </div>
    </section>
  )
}

function BookingRules({ profile, userId, onSaved, toast }) {
  const [v, setV] = useState({
    timezone: profile.timezone,
    min_notice_hours: profile.min_notice_hours,
    max_advance_days: profile.max_advance_days,
    buffer_minutes: profile.buffer_minutes,
    slot_interval_minutes: profile.slot_interval_minutes,
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  const save = async () => {
    setBusy(true)
    try {
      await updateStylistProfile(userId, {
        timezone: v.timezone,
        min_notice_hours: Number(v.min_notice_hours),
        max_advance_days: Number(v.max_advance_days),
        buffer_minutes: Number(v.buffer_minutes),
        slot_interval_minutes: Number(v.slot_interval_minutes),
      })
      await onSaved()
      toast.success('Booking rules saved')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-6">
      <SectionTitle action={<Button onClick={save} loading={busy}>Save rules</Button>}>Booking rules</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Time zone" value={v.timezone} onChange={set('timezone')} options={TIMEZONES.map((t) => ({ value: t, label: t.replace('America/', '').replace('_', ' ') }))} />
        <Select label="Minimum notice" value={String(v.min_notice_hours)} onChange={set('min_notice_hours')}
          options={[0, 2, 4, 12, 24, 48, 72].map((h) => ({ value: String(h), label: h === 0 ? 'No notice needed' : `${h} hours` }))} />
        <Select label="Book up to" value={String(v.max_advance_days)} onChange={set('max_advance_days')}
          options={[14, 30, 60, 90, 180].map((d) => ({ value: String(d), label: `${d} days ahead` }))} />
        <Select label="Break between appointments" value={String(v.buffer_minutes)} onChange={set('buffer_minutes')}
          options={[0, 10, 15, 30, 45, 60].map((m) => ({ value: String(m), label: m ? `${m} minutes` : 'None' }))} />
        <Select label="Start times every" value={String(v.slot_interval_minutes)} onChange={set('slot_interval_minutes')}
          options={[15, 30, 60].map((m) => ({ value: String(m), label: `${m} minutes` }))} />
      </div>
    </section>
  )
}
