import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import type { StateCategory, WorkItem } from '@shared/types'
import { ago, fmtDur, todayTotals } from '@shared/time'
import { FocusButton, OpenInAdo, StaleBadge, TypeChip, bucket, useApp } from '../components'
import { call } from '../api'

const COLS = [
  { key: 'todo', label: 'To do', category: 'Proposed' },
  { key: 'doing', label: 'Doing', category: 'InProgress' },
  { key: 'review', label: 'Review / resolved', category: 'Resolved' },
  { key: 'done', label: 'Done this week', category: 'Completed' }
] as const
type ColKey = (typeof COLS)[number]['key']

const MIME = 'application/x-golau-card'

interface Chooser {
  item: WorkItem
  states: string[]
  x: number
  y: number
}

export function Board(): ReactNode {
  const { work, refreshWork, state, types, toast, updateItem } = useApp()
  const [busy, setBusy] = useState(false)
  const [sprintOnly, setSprintOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const totals = useMemo(() => todayTotals(state), [state])

  // drag and drop
  const [dragId, setDragId] = useState<number | null>(null)
  const [over, setOver] = useState<ColKey | null>(null)
  const [pending, setPending] = useState<Map<number, { category: StateCategory; state: string }>>(new Map())
  const [chooser, setChooser] = useState<Chooser | null>(null)

  const sprints = [...new Set((work ?? []).map((i) => i.iterationPath).filter(Boolean))] as string[]
  // the most common iteration among active items is "the current sprint" (no team needed)
  const current = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of work ?? []) if (i.iterationPath && i.category !== 'Completed') counts.set(i.iterationPath, (counts.get(i.iterationPath) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }, [work])

  // a card being moved shows in its new column straight away (and snaps back if the move fails)
  const items = (work ?? [])
    .filter((i) => (!sprintOnly || i.iterationPath === current) && (!typeFilter || i.type === typeFilter))
    .map((i) => {
      const p = pending.get(i.id)
      return p ? { ...i, category: p.category, state: p.state } : i
    })
  const cols = bucket(items)
  const presentTypes = [...new Set((work ?? []).map((i) => i.type))]
  const dragged = dragId != null ? items.find((i) => i.id === dragId) : undefined

  /** States of this card's type that belong to a column (e.g. Scrum has no "Resolved"). */
  const statesFor = (item: WorkItem, col: ColKey): string[] => {
    const cat = COLS.find((c) => c.key === col)!.category
    return types.find((t) => t.name === item.type)?.states.filter((s) => s.category === cat).map((s) => s.name) ?? []
  }
  const verdict = (col: ColKey): 'same' | 'ok' | 'no' | null => {
    if (!dragged) return null
    if (dragged.category === COLS.find((c) => c.key === col)!.category) return 'same'
    return statesFor(dragged, col).length ? 'ok' : 'no'
  }

  const move = async (item: WorkItem, col: ColKey, to: string): Promise<void> => {
    const category = COLS.find((c) => c.key === col)!.category
    setPending((p) => new Map(p).set(item.id, { category, state: to }))
    const done = await updateItem(item, { 'System.State': to })
    setPending((p) => {
      const n = new Map(p)
      n.delete(item.id)
      return n
    })
    if (done) toast(`#${item.id} → ${done.state}`)
  }

  const drop = (e: DragEvent, col: ColKey): void => {
    e.preventDefault()
    setOver(null)
    const item = dragged
    setDragId(null)
    if (!item || verdict(col) !== 'ok') return
    const states = statesFor(item, col)
    if (states.length === 1) void move(item, col, states[0])
    else setChooser({ item, states, x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div className="page-head">
        <h1>My work</h1>
        <span className="spacer" />
        <div className="chips">
          <button className={`chip ${!typeFilter ? 'on' : ''}`} onClick={() => setTypeFilter(null)}>
            All types
          </button>
          {presentTypes.map((t) => (
            <button key={t} className={`chip ${typeFilter === t ? 'on' : ''}`} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        {current && sprints.length > 1 && (
          <label className="check small">
            <input type="checkbox" checked={sprintOnly} onChange={(e) => setSprintOnly(e.target.checked)} />
            {current.split('\\').pop()} only
          </label>
        )}
        <button className="btn sm" title="Open your team's board in Azure DevOps" onClick={() => void call('openBoard')}>
          <ExternalLink size={14} /> ADO board
        </button>
        <button
          className="icon-btn"
          title="Refresh"
          onClick={async () => {
            setBusy(true)
            await refreshWork(true)
            setBusy(false)
          }}
        >
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
        </button>
      </div>
      {work === null ? (
        <div className="empty">Loading your cards…</div>
      ) : (
        <div className={`board ${dragged ? 'dragging-any' : ''}`}>
          {COLS.map((c) => {
            const v = over === c.key ? verdict(c.key) : null
            return (
              <div
                className={`column ${v === 'ok' ? 'drop-ok' : v === 'no' ? 'drop-no' : ''}`}
                key={c.key}
                data-col={c.key}
                onDragEnter={(e) => {
                  if (!dragged) return
                  e.preventDefault()
                  setOver(c.key)
                }}
                onDragOver={(e) => {
                  if (!dragged) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = verdict(c.key) === 'ok' ? 'move' : 'none'
                  if (over !== c.key) setOver(c.key)
                }}
                onDragLeave={(e) => {
                  // ignore moves between the column's own children
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === c.key ? null : o))
                }}
                onDrop={(e) => drop(e, c.key)}
              >
                <h3>
                  {c.label} <span className="pill">{cols[c.key].length}</span>
                </h3>
                {v === 'no' && dragged && <div className="drop-hint">{dragged.type} has no state for this column</div>}
                {cols[c.key].map((i) => (
                  <Tile
                    key={i.id}
                    item={i}
                    todayMs={totals.get(String(i.id))}
                    dragging={dragId === i.id}
                    pending={pending.has(i.id)}
                    onDragStart={() => setDragId(i.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOver(null)
                    }}
                  />
                ))}
                {cols[c.key].length === 0 && <div className="faint small drop-empty">{dragged && v === 'ok' ? 'Drop here' : '—'}</div>}
              </div>
            )
          })}
        </div>
      )}
      {types.length === 0 && work && work.length > 0 && <div className="faint small" style={{ marginTop: 10 }}>Loading work item types…</div>}
      {chooser && (
        <StateChooser
          chooser={chooser}
          onPick={(s) => {
            const col = COLS.find((c) => statesFor(chooser.item, c.key).includes(s))!.key
            setChooser(null)
            void move(chooser.item, col, s)
          }}
          onClose={() => setChooser(null)}
        />
      )}
    </>
  )
}

/** Small menu at the drop point when a column holds more than one state for this type. */
function StateChooser({ chooser, onPick, onClose }: { chooser: Chooser; onPick: (s: string) => void; onClose: () => void }): ReactNode {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const x = Math.min(chooser.x, window.innerWidth - 220)
  const y = Math.min(chooser.y, window.innerHeight - 40 - chooser.states.length * 34)
  return (
    <div className="chooser-backdrop" onMouseDown={onClose}>
      <div className="state-chooser" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="faint small" style={{ padding: '2px 8px 4px' }}>
          Move #{chooser.item.id} to
        </div>
        {chooser.states.map((s, i) => (
          <button key={s} className="btn ghost sm" autoFocus={i === 0} onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Tile({
  item,
  todayMs,
  dragging,
  pending,
  onDragStart,
  onDragEnd
}: {
  item: WorkItem
  todayMs?: number
  dragging: boolean
  pending: boolean
  onDragStart: () => void
  onDragEnd: () => void
}): ReactNode {
  const { state, types, openItem, toast, updateItem } = useApp()
  const t = types.find((x) => x.name === item.type)
  return (
    <div
      className={`tile ${state.focus?.itemId === item.id ? 'focused' : ''} ${dragging ? 'dragging' : ''} ${pending ? 'pending' : ''}`}
      draggable={!pending}
      data-id={item.id}
      onDragStart={(e) => {
        // let the state dropdown work normally
        if ((e.target as HTMLElement).closest('select, button')) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData(MIME, String(item.id))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={() => openItem(item.id)}
    >
      <div className="row">
        <TypeChip type={item.type} />
        <span className="faint mono small">{item.id}</span>
        <span className="spacer" />
        <OpenInAdo id={item.id} />
        {pending ? <Loader2 size={14} className="spin" /> : <FocusButton item={item} />}
      </div>
      <div className="title">{item.title}</div>
      <div className="row wrap" onClick={(e) => e.stopPropagation()}>
        {t ? (
          <select
            className="select inline"
            value={item.state}
            disabled={pending}
            onChange={(e) => void updateItem(item, { 'System.State': e.target.value }).then((x) => x && toast(`#${x.id} → ${x.state}`))}
          >
            {t.states.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        ) : (
          <span className="pill">{item.state}</span>
        )}
        <StaleBadge item={item} />
        {todayMs ? <span className="pill accent mono">{fmtDur(todayMs)}</span> : null}
        <span className="spacer" />
        <span className="faint small">{ago(item.changedDate)}</span>
      </div>
    </div>
  )
}
