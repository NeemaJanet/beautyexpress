import { useState } from 'react'
import { useToast } from '../../contexts/ToastContext.jsx'
import { dollarsToCents, formatMoney } from '../../lib/pricing.js'
import { friendlyError } from '../../lib/validation.js'
import { deleteOption, saveOption } from '../../services/stylistService.js'
import { Button } from '../common/Button.jsx'
import { Input, Select } from '../common/Field.jsx'

/**
 * Options for one service, e.g.
 *   Length (choose one): Shoulder +$0, Mid-back +$30 (+1 h), Waist +$60 (+2 h)
 *   Add-ons: Curly ends +$15, I bring my own hair −$20
 */
export function OptionsEditor({ service, onChanged }) {
  const toast = useToast()
  const [draft, setDraft] = useState({ group_name: '', group_type: 'choose_one', name: '', price: '0', minutes: '0' })
  const [busy, setBusy] = useState(false)
  const options = [...(service.service_options || [])].sort((a, b) => a.group_name.localeCompare(b.group_name) || a.sort_order - b.sort_order)
  const groups = [...new Set(options.map((o) => o.group_name))]

  const add = async () => {
    if (!draft.group_name.trim() || !draft.name.trim()) return toast.error('Enter a group and an option name.')
    setBusy(true)
    try {
      const existingType = options.find((o) => o.group_name === draft.group_name.trim())?.group_type
      await saveOption({
        stylist_service_id: service.id,
        group_name: draft.group_name.trim(),
        group_type: existingType || draft.group_type,
        name: draft.name.trim(),
        price_delta_cents: dollarsToCents(draft.price) || 0,
        duration_delta_minutes: Number(draft.minutes) || 0,
        sort_order: options.filter((o) => o.group_name === draft.group_name.trim()).length + 1,
      })
      setDraft({ ...draft, name: '', price: '0', minutes: '0' })
      onChanged()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (o) => {
    await saveOption({ id: o.id, is_active: !o.is_active }).catch((e) => toast.error(friendlyError(e)))
    onChanged()
  }

  const remove = async (o) => {
    try {
      await deleteOption(o.id)
      onChanged()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  return (
    <div className="space-y-4">
      {groups.length === 0 && <p className="text-sm text-stone">No options yet. Add lengths, sizes or extras that change the price or time.</p>}
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 text-sm font-medium">
            {g} <span className="font-normal text-stone">({options.find((o) => o.group_name === g).group_type === 'choose_one' ? 'client chooses one' : 'optional extras'})</span>
          </p>
          <ul className="divide-y divide-sand rounded-[var(--radius-control)] border border-sand text-sm">
            {options.filter((o) => o.group_name === g).map((o) => (
              <li key={o.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${o.is_active ? '' : 'opacity-50'}`}>
                <span className="flex-1">{o.name}</span>
                <span className="text-stone">
                  {o.price_delta_cents >= 0 ? '+' : '−'}{formatMoney(Math.abs(o.price_delta_cents))}, {o.duration_delta_minutes >= 0 ? '+' : '−'}{Math.abs(o.duration_delta_minutes)} min
                </span>
                <Button size="sm" variant="ghost" onClick={() => toggle(o)}>{o.is_active ? 'Hide' : 'Show'}</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(o)}>Delete</Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="rounded-[var(--radius-control)] bg-sand-soft p-4">
        <p className="mb-3 text-sm font-medium">Add an option</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Group" list={`groups-${service.id}`} placeholder="Length" value={draft.group_name} onChange={(e) => setDraft({ ...draft, group_name: e.target.value })} />
          <datalist id={`groups-${service.id}`}>{groups.map((g) => <option key={g} value={g} />)}</datalist>
          {!groups.includes(draft.group_name.trim()) && (
            <Select label="Group type" value={draft.group_type} onChange={(e) => setDraft({ ...draft, group_type: e.target.value })}
              options={[{ value: 'choose_one', label: 'Client chooses exactly one' }, { value: 'add_on', label: 'Optional extras' }]} />
          )}
          <Input label="Option name" placeholder="Mid-back" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input label="Price change ($)" type="number" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} hint="Use a negative number for discounts." />
          <Input label="Time change (minutes)" type="number" step="15" value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: e.target.value })} />
        </div>
        <Button size="sm" className="mt-3" onClick={add} loading={busy}>Add option</Button>
      </div>
    </div>
  )
}
