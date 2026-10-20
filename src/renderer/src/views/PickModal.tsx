import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, Plus, Zap } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { dayKey } from '@shared/time'
import { call } from '../api'
import { Modal, ModalHead, StatePill, TypeChip, useApp, useAutoFocus, useDebounced, useStartFocus } from '../components'

/**
 * "What are you working on?" One box: type to filter your cards, search everything,
 * or keep what you typed as unplanned work. Arrow keys + Enter.
 */
export function PickModal({
  onClose,
  onPick,
  title
}: {
  onClose: () => void
  /** override: pick a card for something other than focus (e.g. linking) */
  onPick?: (item: WorkItem) => Promise<void> | void
  title?: string
}): ReactNode {
  const { work, state, go, toast } = useApp()
  const start = useStartFocus()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [remote, setRemote] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [kb, setKb] = useState(0)
  const input = useAutoFocus<HTMLInputElement>()

  const planIds = state.plans[dayKey()]?.itemIds ?? []
  const local = useMemo(() => {
    const active = (work ?? []).filter((i) => i.category !== 'Completed' && i.category !== 'Removed')
    const rank = (i: WorkItem): number =>
      (planIds.includes(i.id) ? 0 : 10) + (i.category === 'InProgress' ? 0 : i.category === 'Resolved' ? 2 : 4)
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return active
      .filter((i) => words.every((w) => `${i.id} ${i.title}`.toLowerCase().includes(w)))
      .sort((a, b) => rank(a) - rank(b))
  }, [work, q, planIds])

  useEffect(() => {
    if (dq.length < 2) {
      setRemote([])
      return
    }
    let live = true
    setLoading(true)
    call('search', { text: dq, status: 'active', assigned: 'anyone' })
      .then((r) => live && setRemote(r))
      .catch(() => live && setRemote([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [dq])

  const localIds = new Set(local.map((i) => i.id))
  const others = remote.filter((i) => !localIds.has(i.id))
  const all = [...local, ...others]
  const extra = onPick ? 0 : q.trim() ? 2 : 0 // "track unplanned" + "create card" rows
  const count = all.length + extra

  useEffect(() => setKb(0), [q])

  const choose = async (item: WorkItem): Promise<void> => {
    try {
      if (onPick) await onPick(item)
      else {
        await start(item)
        onClose()
      }
    } catch (e) {
      toast((e as Error).message, { error: true })
    }
  }
  const unplanned = async (): Promise<void> => {
    await call('focusUnplanned', q.trim())
    onClose()
  }
  const create = (): void => go({ view: 'create', prefill: { title: q.trim(), startFocus: true } })

  const act = (i: number): void => {
    if (i < all.length) void choose(all[i])
    else if (i === all.length) void unplanned()
    else create()
  }

  const row = (item: WorkItem, idx: number, label?: string): ReactNode => (
    <div key={item.id} className={`pick ${kb === idx ? 'kb' : ''}`} onMouseEnter={() => setKb(idx)} onClick={() => void choose(item)}>
      <TypeChip type={item.type} showName={false} />
      <span className="faint mono small">{item.id}</span>
      <span className="ellipsis" style={{ flex: 1 }}>
        {item.title}
      </span>
      {label && <span className="pill accent">{label}</span>}
      {item.assignedTo && !localIds.has(item.id) && <span className="small faint ellipsis" style={{ maxWidth: 120 }}>{item.assignedTo.name}</span>}
      <StatePill item={item} />
    </div>
  )

  return (
    <Modal onClose={onClose}>
      <ModalHead title={title ?? 'What are you working on?'} onClose={onClose} />
      <input
        ref={input}
        className="input"
        style={{ fontSize: 16, padding: '10px 12px' }}
        placeholder={onPick ? 'Search cards by title or #id' : 'Type a card name, #id, or describe what you\'re doing'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setKb((k) => Math.min(count - 1, k + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setKb((k) => Math.max(0, k - 1))
          } else if (e.key === 'Enter' && count) {
            e.preventDefault()
            act(kb)
          }
        }}
      />
      <div className="pick-list">
        {local.length > 0 && <div className="section-title" style={{ margin: '4px 0 2px' }}>Your cards</div>}
        {local.map((i, idx) => row(i, idx, planIds.includes(i.id) ? 'today' : undefined))}
        {(others.length > 0 || loading) && (
          <div className="section-title" style={{ margin: '10px 0 2px' }}>
            Everything else {loading && <Loader2 size={12} className="spin" />}
          </div>
        )}
        {others.map((i, idx) => row(i, local.length + idx))}
        {!onPick && q.trim() && (
          <>
            <div className="section-title" style={{ margin: '10px 0 2px' }}>No card?</div>
            <div className={`pick ${kb === all.length ? 'kb' : ''}`} onMouseEnter={() => setKb(all.length)} onClick={() => void unplanned()}>
              <Zap size={16} style={{ color: 'var(--amber)' }} />
              <span style={{ flex: 1 }}>
                Track “{q.trim()}” as unplanned <span className="faint small">(I'll ask about a card later)</span>
              </span>
            </div>
            <div className={`pick ${kb === all.length + 1 ? 'kb' : ''}`} onMouseEnter={() => setKb(all.length + 1)} onClick={create}>
              <Plus size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ flex: 1 }}>Create a card “{q.trim()}” and start it</span>
            </div>
          </>
        )}
        {!q && local.length === 0 && <div className="empty">Nothing assigned to you is open. Type to search everything.</div>}
      </div>
      <div className="small faint">↑↓ to move · Enter to pick · Esc to close</div>
    </Modal>
  )
}
