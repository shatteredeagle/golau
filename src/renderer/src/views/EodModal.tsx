import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Loader2, PartyPopper } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { dayKey, fmtDur, startOfDay, todayTotals } from '@shared/time'
import { staleItems } from '@shared/stale'
import { call } from '../api'
import { Modal, ModalHead, StaleBadge, StatePill, Steps, TypeChip, useApp } from '../components'
import { PickModal } from './PickModal'
import { CreateModal } from './CreateModal'

const CHIPS = ['Made progress', 'Blocked on ', 'Ready for review', 'Waiting on someone', 'Picking up tomorrow']

/**
 * End of day: one card at a time. Each step is optional; Skip is always one click.
 * Goal is "cards match reality", not a report.
 */
export function EodModal({ onClose }: { onClose: () => void }): ReactNode {
  const { work, state, settings, toast } = useApp()
  const totals = useMemo(() => todayTotals(state), [state])
  const plan = state.plans[dayKey()]
  const [extra, setExtra] = useState<WorkItem[]>([])
  const [idx, setIdx] = useState(0)
  const [saved, setSaved] = useState<number[]>([])

  const ids = useMemo(() => {
    const touched = [...totals.entries()]
      .filter(([k]) => !k.startsWith('u:'))
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => Number(k))
    const planned = plan?.itemIds ?? []
    const stale = staleItems(work ?? [], settings.staleDays).map((i) => i.id)
    return [...new Set([...touched, ...planned, ...stale])]
  }, [totals, plan, work, settings.staleDays])

  const byId = useMemo(() => new Map([...(work ?? []), ...extra].map((i) => [i.id, i])), [work, extra])
  const missing = ids.filter((id) => !byId.has(id))
  useEffect(() => {
    if (missing.length) void call('getItems', missing).then(setExtra).catch(() => undefined)
  }, [missing.join(',')])

  const cards = ids.map((id) => byId.get(id)).filter((i): i is WorkItem => !!i && i.category !== 'Removed')
  const sod = startOfDay()
  const unplanned = state.unplanned.filter(
    (u) => !u.resolution && (u.createdAt >= sod || state.sessions.some((s) => s.unplannedId === u.id && (s.end ?? Date.now()) >= sod))
  )
  const steps = cards.length + (unplanned.length ? 1 : 0) + 1
  const atSummary = idx >= steps - 1
  const atUnplanned = !atSummary && idx >= cards.length

  const finish = (): void => {
    void call('setEod', 'done')
    onClose()
  }

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        title={atSummary ? 'That\'s a wrap' : atUnplanned ? 'Unplanned stuff from today' : 'Wrap up the day'}
        sub={atSummary ? undefined : atUnplanned ? 'Give it a home, or just let it be.' : `Card ${idx + 1} of ${cards.length}. Update what changed, skip what didn't.`}
        onClose={onClose}
      />
      <Steps n={steps} at={idx} />
      {work === null && <Loader2 className="spin" />}

      {!atSummary && !atUnplanned && cards[idx] && (
        <CardStep
          key={cards[idx].id}
          item={cards[idx]}
          todayMs={totals.get(String(cards[idx].id)) ?? 0}
          planned={!!plan?.itemIds.includes(cards[idx].id)}
          onDone={(didSave) => {
            if (didSave) setSaved((s) => [...s, cards[idx].id])
            setIdx(idx + 1)
          }}
        />
      )}

      {atUnplanned && <UnplannedStep entries={unplanned} totals={totals} onNext={() => setIdx(idx + 1)} />}

      {atSummary && (
        <div className="stack" style={{ textAlign: 'center', padding: '10px 0' }}>
          <PartyPopper size={40} style={{ margin: '0 auto', color: 'var(--accent)' }} />
          <div style={{ fontSize: 17 }}>
            {fmtDur([...totals.values()].reduce((a, b) => a + b, 0))} tracked today
            {saved.length > 0 && <> · {saved.length} card{saved.length > 1 ? 's' : ''} updated</>}
          </div>
          <div className="muted">
            {state.wins.filter((w) => w.at >= sod && w.kind === 'closed').length > 0
              ? `You closed ${state.wins.filter((w) => w.at >= sod && w.kind === 'closed').length} today. `
              : ''}
            Your notes will be waiting tomorrow morning.
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
            {state.focus && (
              <button
                className="btn"
                onClick={() => {
                  void call('stopFocus')
                  toast('Timer stopped')
                }}
              >
                Stop the timer
              </button>
            )}
            <button className="btn primary lg" onClick={finish}>
              <Check size={16} /> Done for today
            </button>
          </div>
        </div>
      )}

      {!atSummary && cards.length === 0 && !atUnplanned && (
        <div className="empty">Nothing tracked or planned today, so nothing to update.</div>
      )}
    </Modal>
  )
}

function CardStep({ item, todayMs, planned, onDone }: { item: WorkItem; todayMs: number; planned: boolean; onDone: (saved: boolean) => void }): ReactNode {
  const { types, state, settings, toast, updateItem } = useApp()
  const t = types.find((x) => x.name === item.type)
  const [st, setSt] = useState(item.state)
  const [update, setUpdate] = useState('')
  const [note, setNote] = useState(state.notes[item.id]?.text ?? '')
  const hours = Math.round((todayMs / 3600000) * 4) / 4
  const [logHours, setLogHours] = useState(settings.logCompletedWork && item.completedWork != null && hours > 0)
  const [remaining, setRemaining] = useState(item.remainingWork != null ? String(Math.max(0, item.remainingWork - (logHours ? hours : 0))) : '')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const fields: Record<string, unknown> = {}
      if (st !== item.state) fields['System.State'] = st
      if (logHours && item.completedWork != null) fields['Microsoft.VSTS.Scheduling.CompletedWork'] = Math.round((item.completedWork + hours) * 100) / 100
      if (item.remainingWork != null && remaining !== '' && Number(remaining) !== item.remainingWork)
        fields['Microsoft.VSTS.Scheduling.RemainingWork'] = Number(remaining)
      // a cancelled "needs more fields" prompt keeps you on this card instead of moving on
      if (Object.keys(fields).length && !(await updateItem(item, fields))) return
      if (update.trim()) await call('addComment', item.id, update.trim(), item.project)
      if (note !== (state.notes[item.id]?.text ?? '')) await call('setNote', item.id, note)
      onDone(Object.keys(fields).length > 0 || !!update.trim())
    } catch (e) {
      toast((e as Error).message, { error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row">
          <TypeChip type={item.type} />
          <span className="faint mono small">#{item.id}</span>
          <StatePill item={item} />
          <StaleBadge item={item} />
          {planned && <span className="pill accent">on today's plan</span>}
          <span className="spacer" />
          <span className="mono muted">{todayMs ? `${fmtDur(todayMs)} today` : 'not tracked today'}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{item.title}</div>
      </div>

      <div className="row wrap" style={{ gap: 14, alignItems: 'end' }}>
        <label className="field">
          State
          {t ? (
            <select className="select" value={st} onChange={(e) => setSt(e.target.value)} style={{ minWidth: 160 }}>
              {t.states.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
          ) : (
            <span>{item.state}</span>
          )}
        </label>
        {item.completedWork != null && hours > 0 && (
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={logHours} onChange={(e) => setLogHours(e.target.checked)} /> Log {hours}h to Completed Work
          </label>
        )}
        {item.remainingWork != null && (
          <label className="field" style={{ width: 120 }}>
            Remaining (h)
            <input className="input" type="number" min={0} step={0.5} value={remaining} onChange={(e) => setRemaining(e.target.value)} />
          </label>
        )}
      </div>

      <label className="field">
        Update for the card <span className="faint">(optional, posts as a comment)</span>
        <div className="chips">
          {CHIPS.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => setUpdate((u) => (u ? `${u.trimEnd()} ${c}` : c))}>
              {c.trim()}
            </button>
          ))}
        </div>
        <textarea className="textarea" rows={2} value={update} onChange={(e) => setUpdate(e.target.value)} />
      </label>

      <label className="field">
        Note to tomorrow-you <span className="faint">(private)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you left off / the very next step" />
      </label>

      <div className="row">
        <button className="btn ghost" onClick={() => onDone(false)}>
          Skip
        </button>
        <span className="spacer" />
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 size={15} className="spin" />} Save & next
        </button>
      </div>
    </div>
  )
}

function UnplannedStep({
  entries,
  totals,
  onNext
}: {
  entries: { id: string; text: string }[]
  totals: Map<string, number>
  onNext: () => void
}): ReactNode {
  const { toast } = useApp()
  const [linking, setLinking] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ id: string; text: string } | null>(null)
  return (
    <div className="stack">
      <div className="list">
        {entries.map((u) => (
          <div key={u.id} className="item-row" style={{ cursor: 'default' }}>
            <span className="pill warn">unplanned</span>
            <span className="title ellipsis">{u.text}</span>
            <span className="pill mono">{fmtDur(totals.get(`u:${u.id}`) ?? 0)}</span>
            <button className="btn sm" onClick={() => setLinking(u.id)}>
              Link to card
            </button>
            <button className="btn sm" onClick={() => setCreating(u)}>
              Make card
            </button>
            <button className="btn sm ghost" onClick={() => void call('resolveUnplanned', u.id, 'kept')}>
              No card
            </button>
          </div>
        ))}
      </div>
      {entries.length === 0 && <div className="empty">All sorted.</div>}
      <div className="row">
        <span className="spacer" />
        <button className="btn primary" onClick={onNext}>
          Next
        </button>
      </div>
      {linking && (
        <PickModal
          title="Link to which card?"
          onClose={() => setLinking(null)}
          onPick={async (item) => {
            await call('linkUnplanned', linking, item.id)
            toast(`Time moved to #${item.id}`)
            setLinking(null)
          }}
        />
      )}
      {creating && (
        <CreateModal
          route={{ view: 'create', prefill: { title: creating.text }, fromUnplanned: creating.id }}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
