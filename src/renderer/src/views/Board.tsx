import { useMemo, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { ago, fmtDur, todayTotals } from '@shared/time'
import { FocusButton, StaleBadge, TypeChip, bucket, useApp } from '../components'

const COLS = [
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'Doing' },
  { key: 'review', label: 'Review / resolved' },
  { key: 'done', label: 'Done this week' }
] as const

export function Board(): ReactNode {
  const { work, refreshWork, state, types } = useApp()
  const [busy, setBusy] = useState(false)
  const [sprintOnly, setSprintOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const totals = useMemo(() => todayTotals(state), [state])

  const sprints = [...new Set((work ?? []).map((i) => i.iterationPath).filter(Boolean))] as string[]
  // the most common iteration among active items is "the current sprint" (no team needed)
  const current = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of work ?? []) if (i.iterationPath && i.category !== 'Completed') counts.set(i.iterationPath, (counts.get(i.iterationPath) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }, [work])

  const items = (work ?? []).filter((i) => (!sprintOnly || i.iterationPath === current) && (!typeFilter || i.type === typeFilter))
  const cols = bucket(items)
  const presentTypes = [...new Set((work ?? []).map((i) => i.type))]

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
        <div className="board">
          {COLS.map((c) => (
            <div className="column" key={c.key}>
              <h3>
                {c.label} <span className="pill">{cols[c.key].length}</span>
              </h3>
              {cols[c.key].map((i) => (
                <Tile key={i.id} item={i} todayMs={totals.get(String(i.id))} />
              ))}
              {cols[c.key].length === 0 && <div className="faint small" style={{ padding: '6px 4px' }}>—</div>}
            </div>
          ))}
        </div>
      )}
      {types.length === 0 && work && work.length > 0 && <div className="faint small" style={{ marginTop: 10 }}>Loading work item types…</div>}
    </>
  )
}

function Tile({ item, todayMs }: { item: WorkItem; todayMs?: number }): ReactNode {
  const { state, types, openItem, toast, updateItem } = useApp()
  const t = types.find((x) => x.name === item.type)
  return (
    <div className={`tile ${state.focus?.itemId === item.id ? 'focused' : ''}`} onClick={() => openItem(item.id)}>
      <div className="row">
        <TypeChip type={item.type} />
        <span className="faint mono small">{item.id}</span>
        <span className="spacer" />
        <FocusButton item={item} />
      </div>
      <div className="title">{item.title}</div>
      <div className="row wrap" onClick={(e) => e.stopPropagation()}>
        {t ? (
          <select
            className="select inline"
            value={item.state}
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
