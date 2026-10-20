import { useMemo, useState, type ReactNode } from 'react'
import { Check, Play } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { dayKey } from '@shared/time'
import { staleItems } from '@shared/stale'
import { call } from '../api'
import { Modal, ModalHead, StaleBadge, StatePill, Steps, TypeChip, bucket, useApp, useStartFocus } from '../components'

/**
 * Morning plan: pick a few cards that would make today a win, then pick where to start.
 * Two steps, skippable, nothing is forced.
 */
export function PlanModal({ onClose }: { onClose: () => void }): ReactNode {
  const { work, state, settings, toast } = useApp()
  const start = useStartFocus()
  const today = dayKey()
  const existing = state.plans[today]

  // yesterday's (or the last plan's) unfinished items come pre-ticked
  const lastPlan = useMemo(() => {
    const keys = Object.keys(state.plans).filter((k) => k < today).sort()
    return keys.length ? state.plans[keys[keys.length - 1]] : undefined
  }, [state.plans, today])

  const cols = bucket(work ?? [])
  const candidates = [...cols.doing, ...cols.review, ...cols.todo]
  const open = new Set(candidates.map((i) => i.id))
  const [picked, setPicked] = useState<number[]>(
    existing && !existing.skipped
      ? existing.itemIds.filter((id) => open.has(id))
      : (lastPlan?.itemIds ?? []).filter((id) => open.has(id))
  )
  const [step, setStep] = useState(0)
  const [first, setFirst] = useState<number | null>(null)
  const stale = staleItems(work ?? [], settings.staleDays)

  const toggle = (id: number): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const byId = new Map(candidates.map((i) => [i.id, i]))
  const pickedItems = picked.map((id) => byId.get(id)).filter(Boolean) as WorkItem[]

  const finish = async (startNow: boolean): Promise<void> => {
    await call('setPlan', picked)
    const f = first ?? picked[0]
    if (startNow && f && byId.get(f)) await start(byId.get(f)!)
    toast(picked.length ? `Plan set: ${picked.length} card${picked.length > 1 ? 's' : ''}` : 'Plan set')
    onClose()
  }

  const group = (label: string, items: WorkItem[]): ReactNode =>
    items.length > 0 && (
      <>
        <div className="section-title" style={{ margin: '8px 0 2px' }}>{label}</div>
        {items.map((i) => (
          <div key={i.id} className={`pick ${picked.includes(i.id) ? 'checked' : ''}`} onClick={() => toggle(i.id)}>
            <input type="checkbox" readOnly checked={picked.includes(i.id)} style={{ accentColor: 'var(--accent)' }} />
            <TypeChip type={i.type} showName={false} />
            <span className="faint mono small">{i.id}</span>
            <span className="ellipsis" style={{ flex: 1 }}>{i.title}</span>
            {lastPlan?.itemIds.includes(i.id) && <span className="pill">carried over</span>}
            <StaleBadge item={i} />
            <StatePill item={i} />
          </div>
        ))}
      </>
    )

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        title={step === 0 ? 'What would make today a win?' : 'Where do you want to start?'}
        sub={step === 0 ? 'Tick 1–3 cards. You can still work on other stuff, this is just your compass.' : 'Pick the first one. Easiest-first is a perfectly good strategy.'}
        onClose={onClose}
      />
      <Steps n={2} at={step} />

      {step === 0 && (
        <>
          {work === null ? (
            <div className="empty">Loading your cards…</div>
          ) : candidates.length === 0 ? (
            <div className="empty">Nothing open is assigned to you. Use Search or New item to grab something.</div>
          ) : (
            <div className="pick-list" style={{ maxHeight: '52vh' }}>
              {group('In progress', cols.doing)}
              {group('In review', cols.review)}
              {group('To do', cols.todo)}
            </div>
          )}
          {picked.length > 3 && <div className="hint">That's {picked.length}. Totally allowed, but 3 is plenty for a day. Fewer = more likely to feel done.</div>}
          {stale.length > 0 && <div className="small muted">{stale.length} of your cards have gone quiet ({settings.staleDays}+ days). Worth a glance in Wrap up or Today.</div>}
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => {
                void call('setPlan', [])
                onClose()
              }}
            >
              No plan today
            </button>
            <span className="spacer" />
            <span className="small muted">{picked.length} picked</span>
            <button className="btn primary" disabled={picked.length === 0} onClick={() => setStep(1)}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="pick-list">
            {pickedItems.map((i) => (
              <div key={i.id} className={`pick ${(first ?? picked[0]) === i.id ? 'checked' : ''}`} onClick={() => setFirst(i.id)}>
                {(first ?? picked[0]) === i.id ? <Play size={15} style={{ color: 'var(--accent)' }} /> : <span style={{ width: 15 }} />}
                <TypeChip type={i.type} showName={false} />
                <span className="faint mono small">{i.id}</span>
                <span className="ellipsis" style={{ flex: 1 }}>{i.title}</span>
                {state.notes[i.id] && <span className="small faint ellipsis" style={{ maxWidth: 220 }}>“{state.notes[i.id].text}”</span>}
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setStep(0)}>
              Back
            </button>
            <span className="spacer" />
            <button className="btn" onClick={() => void finish(false)}>
              <Check size={15} /> Save plan
            </button>
            <button className="btn primary" onClick={() => void finish(true)}>
              <Play size={15} /> Save & start
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
