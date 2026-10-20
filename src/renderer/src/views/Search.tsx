import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Search as SearchIcon } from 'lucide-react'
import type { SearchQuery, WorkItem } from '@shared/types'
import { ago } from '@shared/time'
import { call } from '../api'
import { StatePill, TypeChip, useApp, useAutoFocus, useDebounced } from '../components'

export function Search(): ReactNode {
  const { types, openItem, state } = useApp()
  const [q, setQ] = useState<SearchQuery>({ text: '', status: 'active', assigned: 'anyone' })
  const dq = useDebounced(q, 400)
  const [results, setResults] = useState<WorkItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const input = useAutoFocus<HTMLInputElement>()

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    call('search', dq)
      .then((r) => live && setResults(r))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [dq])

  const set = (patch: Partial<SearchQuery>): void => setQ((x) => ({ ...x, ...patch }))
  const toggleType = (t: string): void => {
    const cur = new Set(q.types ?? [])
    if (cur.has(t)) cur.delete(t)
    else cur.add(t)
    set({ types: [...cur] })
  }

  return (
    <>
      <div className="page-head">
        <h1>Search</h1>
      </div>
      <div className="stack">
        <div className="row" style={{ position: 'relative' }}>
          <SearchIcon size={17} style={{ position: 'absolute', left: 12, color: 'var(--faint)' }} />
          <input
            ref={input}
            className="input"
            style={{ paddingLeft: 38, fontSize: 15, height: 42 }}
            placeholder="Words in the title, or #1234"
            value={q.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          {loading && <Loader2 size={17} className="spin" style={{ position: 'absolute', right: 12, color: 'var(--faint)' }} />}
        </div>
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="seg">
            {(['active', 'any', 'done'] as const).map((s) => (
              <button key={s} className={q.status === s ? 'on' : ''} onClick={() => set({ status: s })}>
                {s === 'active' ? 'Open' : s === 'any' ? 'Any state' : 'Closed'}
              </button>
            ))}
          </div>
          <div className="seg">
            {(['anyone', 'me', 'unassigned'] as const).map((s) => (
              <button key={s} className={q.assigned === s ? 'on' : ''} onClick={() => set({ assigned: s })}>
                {s === 'anyone' ? 'Anyone' : s === 'me' ? 'Mine' : 'Unassigned'}
              </button>
            ))}
          </div>
          <label className="check small">
            <input type="checkbox" checked={!!q.allProjects} onChange={(e) => set({ allProjects: e.target.checked })} /> All projects
          </label>
          <label className="check small">
            <input type="checkbox" checked={!!q.includeDescription} onChange={(e) => set({ includeDescription: e.target.checked })} /> Search descriptions
          </label>
        </div>
        <div className="chips">
          {types.map((t) => (
            <button key={t.name} className={`chip ${q.types?.includes(t.name) ? 'on' : ''}`} onClick={() => toggleType(t.name)}>
              {t.name}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        {results && (
          <div className="small faint">
            {results.length === 100 ? 'First 100 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
            {!q.text && ' · showing recently changed'}
          </div>
        )}
        <div className="list">
          {results?.map((i) => (
            <div key={i.id} className={`item-row ${state.focus?.itemId === i.id ? 'focused' : ''}`} onClick={() => openItem(i.id)}>
              <TypeChip type={i.type} showName={false} />
              <span className="id mono">{i.id}</span>
              <span className="title ellipsis">{i.title}</span>
              {q.allProjects && <span className="pill">{i.project}</span>}
              <span className="small faint ellipsis" style={{ maxWidth: 140 }}>
                {i.assignedTo?.name ?? 'Unassigned'}
              </span>
              <span className="small faint" style={{ width: 74, textAlign: 'right' }}>
                {ago(i.changedDate)}
              </span>
              <StatePill item={i} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
