import { useMemo, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Link2, MessageSquarePlus, Moon, Pause, Plus, Sparkles, Sunrise } from 'lucide-react'
import type { UnplannedEntry, WorkItem } from '@shared/types'
import { atTime, dayKey, fmtClock, fmtDur, startOfDay, todayTotals } from '@shared/time'
import { call, useNow } from '../api'
import { ItemRow, StatePill, TypeChip, bucket, useApp } from '../components'
import { staleItems } from '@shared/stale'
import { PickModal } from './PickModal'

export function Today(): ReactNode {
  const { state, work, settings, go, workError } = useApp()
  const now = useNow(15000)
  const totals = useMemo(() => todayTotals(state, now), [state, now])
  const plan = state.plans[dayKey(now)]
  const byId = useMemo(() => new Map((work ?? []).map((i) => [i.id, i])), [work])
  const cols = bucket(work ?? [])
  const totalToday = [...totals.values()].reduce((a, b) => a + b, 0)

  const planned = (plan?.itemIds ?? []).map((id) => byId.get(id)).filter(Boolean) as WorkItem[]
  const plannedIds = new Set(planned.map((i) => i.id))
  const alsoDoing = cols.doing.filter((i) => !plannedIds.has(i.id))
  const stale = staleItems(work ?? [], settings.staleDays, now)

  const sod = startOfDay(now)
  const unplannedToday = state.unplanned.filter(
    (u) =>
      (!u.resolution || u.resolution.kind === 'kept') &&
      (u.createdAt >= sod || state.sessions.some((s) => s.unplannedId === u.id && (s.end ?? now) >= sod))
  )

  const winsToday = state.wins.filter((w) => w.at >= sod)
  const closed = winsToday.filter((w) => w.kind === 'closed').length
  const updates = new Set(winsToday.filter((w) => w.kind !== 'closed').map((w) => w.itemId)).size
  const lateDay = now >= atTime(settings.eodTime, now) - 30 * 60000

  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Evening'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting}</h1>
          <div className="muted small">
            {new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {totalToday > 60000 && <> · {fmtDur(totalToday)} tracked today</>}
          </div>
        </div>
        <span className="spacer" />
        {!plan && (
          <button className="btn" onClick={() => go({ view: 'plan' })}>
            <Sunrise size={15} /> Plan my day
          </button>
        )}
        <button className={`btn ${lateDay && !state.eod[dayKey(now)] ? 'primary' : ''}`} onClick={() => go({ view: 'eod' })}>
          <Moon size={15} /> Wrap up day
        </button>
      </div>

      {workError && <div className="error" style={{ marginBottom: 16 }}>{workError}</div>}

      <div className="today-grid">
        <div className="stack" style={{ gap: 22 }}>
          <Hero byId={byId} />

          <section>
            <div className="section-title">
              Today's plan
              {plan && !plan.skipped && (
                <button className="btn ghost sm" onClick={() => go({ view: 'plan' })}>
                  edit
                </button>
              )}
            </div>
            {!plan || plan.skipped ? (
              <div className="empty">
                No plan yet. <a href="#" onClick={(e) => { e.preventDefault(); go({ view: 'plan' }) }}>Pick 1–3 things</a> that would make today a win.
              </div>
            ) : planned.length === 0 ? (
              <div className="empty">Your planned cards aren't assigned to you anymore, or are still loading.</div>
            ) : (
              <div className="list">
                {planned.map((i) => (
                  <ItemRow key={i.id} item={i} todayMs={totals.get(String(i.id))} />
                ))}
              </div>
            )}
          </section>

          {alsoDoing.length > 0 && (
            <section>
              <div className="section-title">{plan && !plan.skipped ? 'Also in progress' : 'In progress'}</div>
              <div className="list">
                {alsoDoing.map((i) => (
                  <ItemRow key={i.id} item={i} todayMs={totals.get(String(i.id))} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack" style={{ gap: 22 }}>
          <section>
            <div className="section-title">
              <Sparkles size={13} /> Today's wins
            </div>
            <div className="wins">
              <div className="win-stat">
                <b className="mono">{fmtDur(totalToday)}</b>
                <span className="small muted">focused</span>
              </div>
              <div className="win-stat">
                <b>{closed}</b>
                <span className="small muted">closed</span>
              </div>
              <div className="win-stat">
                <b>{updates}</b>
                <span className="small muted">cards updated</span>
              </div>
            </div>
            {winsToday.length > 0 && (
              <div className="small muted" style={{ marginTop: 8, display: 'grid', gap: 2 }}>
                {winsToday
                  .slice(-5)
                  .reverse()
                  .map((w, i) => (
                    <span key={i} className="ellipsis">
                      <Check size={12} style={{ color: 'var(--green)', verticalAlign: -1 }} /> {w.kind} {w.itemId ? `#${w.itemId}` : ''} {w.title}
                    </span>
                  ))}
              </div>
            )}
          </section>

          <Untracked entries={unplannedToday} totals={totals} />

          {stale.length > 0 && (
            <section>
              <div className="section-title">
                Gone quiet
                <button className="btn ghost sm" onClick={() => go({ view: 'stale' })}>
                  review
                </button>
              </div>
              <div className="list">
                {stale.slice(0, 4).map((i) => (
                  <ItemRow key={i.id} item={i} compact />
                ))}
              </div>
            </section>
          )}

          <QuickInbox />
        </div>
      </div>
    </>
  )
}

/** The big "right now" card. */
function Hero({ byId }: { byId: Map<number, WorkItem> }): ReactNode {
  const { state, types, toast, openItem, go } = useApp()
  const now = useNow()
  const f = state.focus
  const [update, setUpdate] = useState('')
  const [posting, setPosting] = useState(false)
  const [linking, setLinking] = useState(false)
  const [text, setText] = useState('')

  if (!f) {
    const p = state.paused
    return (
      <div className="hero">
        <div className="small faint">{p ? 'Paused' : 'Right now'}</div>
        <h2>{p ? p.focus.title : 'Nothing in focus'}</h2>
        <div className="row wrap" style={{ marginTop: 12 }}>
          {p && (
            <button className="btn primary" onClick={() => void call('resume')}>
              Resume
            </button>
          )}
          <button className={`btn ${p ? '' : 'primary'}`} onClick={() => go({ view: 'pick' })}>
            Pick a card
          </button>
        </div>
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) void call('focusUnplanned', text).then(() => setText(''))
          }}
        >
          <input className="input" placeholder="…or just type what you're doing and hit Enter" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
      </div>
    )
  }

  if (!f.itemId) {
    const u = state.unplanned.find((x) => x.id === f.unplannedId)
    return (
      <div className="hero unplanned">
        <div className="row">
          <span className="pill warn">Unplanned</span>
          <span className="spacer" />
          <span className="clock mono">{fmtClock(now - f.startedAt)}</span>
        </div>
        <input
          className="title-edit"
          style={{ fontSize: 21, marginTop: 6 }}
          defaultValue={f.title}
          onBlur={(e) => u && e.target.value.trim() && e.target.value !== f.title && void call('renameUnplanned', u.id, e.target.value.trim())}
        />
        <div className="muted small" style={{ marginTop: 6 }}>
          Totally fine to do unplanned work. Is there a card it belongs to?
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => go({ view: 'create', prefill: { title: f.title }, fromUnplanned: f.unplannedId })}>
            <Plus size={15} /> Make a card
          </button>
          <button className="btn" onClick={() => setLinking(true)}>
            <Link2 size={15} /> Link to existing
          </button>
          <button className="btn ghost" onClick={() => u && void call('resolveUnplanned', u.id, 'kept')}>
            No card needed
          </button>
          <span className="spacer" />
          <button className="icon-btn" title="Pause" onClick={() => void call('pause')}>
            <Pause size={17} />
          </button>
        </div>
        {linking && u && (
          <PickModal
            title="Link to which card?"
            onClose={() => setLinking(false)}
            onPick={async (item) => {
              await call('linkUnplanned', u.id, item.id)
              toast(`Time moved to #${item.id}`)
              setLinking(false)
            }}
          />
        )}
      </div>
    )
  }

  const item = byId.get(f.itemId)
  const note = state.notes[f.itemId]?.text ?? ''
  const typeInfo = types.find((t) => t.name === (item?.type ?? f.type))
  const doneState = typeInfo?.states.find((s) => s.category === 'Completed')

  const post = async (): Promise<void> => {
    if (!update.trim()) return
    setPosting(true)
    try {
      await call('addComment', f.itemId!, update.trim(), item?.project)
      setUpdate('')
      toast('Update posted to the card')
    } catch (e) {
      toast((e as Error).message, { error: true })
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="hero">
      <div className="row">
        <TypeChip type={item?.type ?? f.type ?? ''} />
        <span className="faint mono small">#{f.itemId}</span>
        {item && <StatePill item={item} />}
        <span className="spacer" />
        <span className="clock mono">{fmtClock(now - f.startedAt)}</span>
      </div>
      <h2 style={{ cursor: 'pointer' }} onClick={() => openItem(f.itemId!)}>
        {f.title}
      </h2>

      <label className="field note">
        Where I'm at / next step <span className="faint">(only you see this, it greets you when you come back)</span>
        <input
          className="input"
          key={f.itemId}
          defaultValue={note}
          placeholder="e.g. callback works, next: handle token refresh"
          onBlur={(e) => e.target.value !== note && void call('setNote', f.itemId!, e.target.value)}
        />
      </label>

      <label className="field" style={{ marginTop: 12 }}>
        Post an update to the card
        <textarea
          className="textarea"
          rows={2}
          value={update}
          placeholder="What changed? Ctrl+Enter to post"
          onChange={(e) => setUpdate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && void post()}
        />
      </label>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn" disabled={!update.trim() || posting} onClick={() => void post()}>
          <MessageSquarePlus size={15} /> Post update
        </button>
        {item && typeInfo && (
          <select
            className="select inline"
            value={item.state}
            onChange={(e) =>
              void call('updateItem', item.id, { 'System.State': e.target.value })
                .then((x) => toast(`#${x.id} → ${x.state}`))
                .catch((er: Error) => toast(er.message, { error: true }))
            }
          >
            {typeInfo.states
              .filter((s) => s.category !== 'Removed')
              .map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
          </select>
        )}
        <span className="spacer" />
        {doneState && item && item.category !== 'Completed' && (
          <button
            className="btn"
            onClick={() =>
              void call('updateItem', item.id, { 'System.State': doneState.name })
                .then(() => toast(`Closed #${item.id}. Nice!`))
                .catch((er: Error) => toast(er.message, { error: true }))
            }
          >
            <Check size={15} /> Done
          </button>
        )}
        {item && (
          <button className="icon-btn" title="Open in Azure DevOps" onClick={() => void call('openExternal', item.webUrl)}>
            <ExternalLink size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function Untracked({ entries, totals }: { entries: UnplannedEntry[]; totals: Map<string, number> }): ReactNode {
  const { state, go, toast } = useApp()
  const [linking, setLinking] = useState<string | null>(null)
  if (!entries.length) return null
  return (
    <section>
      <div className="section-title">Unplanned today</div>
      <div className="list">
        {entries.map((u) => (
          <div key={u.id} className="unplanned-row">
            <div className="row">
              <span className="ellipsis" style={{ flex: 1 }} title={u.text}>
                {u.text}
              </span>
              <span className="pill mono">{fmtDur(totals.get(`u:${u.id}`) ?? 0)}</span>
            </div>
            <div className="row">
              {u.resolution?.kind === 'kept' ? (
                <span className="pill">no card needed</span>
              ) : (
                <>
                  <button className="btn sm" onClick={() => go({ view: 'create', prefill: { title: u.text }, fromUnplanned: u.id })}>
                    <Plus size={13} /> Make card
                  </button>
                  <button className="btn sm" onClick={() => setLinking(u.id)}>
                    <Link2 size={13} /> Link
                  </button>
                </>
              )}
              <span className="spacer" />
              {state.focus?.unplannedId !== u.id && (
                <button className="btn sm ghost" title="Track this again" onClick={() => void call('resumeUnplanned', u.id)}>
                  Resume
                </button>
              )}
            </div>
          </div>
        ))}
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
    </section>
  )
}

function QuickInbox(): ReactNode {
  const { state, go } = useApp()
  const [text, setText] = useState('')
  const open = state.inbox.filter((x) => !x.done)
  return (
    <section>
      <div className="section-title">
        Brain dump
        {open.length > 0 && (
          <button className="btn ghost sm" onClick={() => go({ view: 'inbox' })}>
            {open.length} in inbox
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) void call('addInbox', text).then(() => setText(''))
        }}
      >
        <input className="input" placeholder="Park a thought, deal with it later (Enter)" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  )
}
