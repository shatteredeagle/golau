import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, Plus, Zap } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { currentPlan } from '@shared/plan'
import { defaultParentTypes, isParentCandidate, parentChips, parentSearch, type ParentChip } from '@shared/parent'
import { call } from '../api'
import { Modal, ModalHead, StatePill, TypeChip, useApp, useAutoFocus, useDebounced, useStartFocus } from '../components'

/**
 * "What are you working on?" One box: type to filter your cards, search everything,
 * or keep what you typed as unplanned work. Arrow keys + Enter.
 */
export function PickModal({
  onClose,
  onPick,
  title,
  parentFor
}: {
  onClose: () => void
  /** override: pick a card for something other than focus (e.g. linking) */
  onPick?: (item: WorkItem) => Promise<void> | void
  title?: string
  /** pick a parent for a card of this type: type chips (the level above is ticked), a project toggle, no self/current parent */
  parentFor?: { type: string; itemId?: number; currentParentId?: number }
}): ReactNode {
  const { work, state, settings, go, toast } = useApp()
  const start = useStartFocus()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [remote, setRemote] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [kb, setKb] = useState(0)
  const input = useAutoFocus<HTMLInputElement>()
  const [chips, setChips] = useState<ParentChip[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [projectOnly, setProjectOnly] = useState(true)
  const [ready, setReady] = useState(!parentFor)
  const parentType = parentFor?.type

  useEffect(() => {
    if (!parentType) return
    let live = true
    call('typeLevels')
      .then((levels) => {
        if (!live) return
        const c = parentChips(parentType, levels)
        setChips(c)
        setPicked(defaultParentTypes(c))
      })
      .catch(() => undefined)
      .finally(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [parentType])

  const planIds = currentPlan(state.plans)?.plan.itemIds ?? []
  const local = useMemo(() => {
    const active = (work ?? []).filter(
      (i) =>
        i.category !== 'Completed' &&
        i.category !== 'Removed' &&
        (!parentFor ||
          (isParentCandidate(i, parentFor.itemId, parentFor.currentParentId) &&
            (!picked.length || picked.includes(i.type)) &&
            (!projectOnly || i.project === settings.project)))
    )
    const rank = (i: WorkItem): number =>
      (planIds.includes(i.id) ? 0 : 10) + (i.category === 'InProgress' ? 0 : i.category === 'Resolved' ? 2 : 4)
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return active
      .filter((i) => words.every((w) => `${i.id} ${i.title}`.toLowerCase().includes(w)))
      .sort((a, b) => rank(a) - rank(b))
  }, [work, q, planIds, parentFor, picked, projectOnly, settings.project])

  useEffect(() => {
    // a parent search also runs on an empty box, so there are suggestions to pick from straight away
    if (!ready || (!parentFor && dq.length < 2)) {
      setRemote([])
      return
    }
    let live = true
    setLoading(true)
    call('search', parentFor ? parentSearch(dq, picked, projectOnly) : { text: dq, status: 'active', assigned: 'anyone' })
      .then((r) => live && setRemote(parentFor ? r.filter((i) => isParentCandidate(i, parentFor.itemId, parentFor.currentParentId)) : r))
      .catch(() => live && setRemote([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [dq, ready, picked, projectOnly, parentFor?.itemId, parentFor?.currentParentId])

  const toggleChip = (t: string): void => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))

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
        placeholder={parentFor ? `Find a parent for this ${parentFor.type} by title or #id` : onPick ? 'Search cards by title or #id' : 'Type a card name, #id, or describe what you\'re doing'}
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
      {parentFor && (
        <div className="row wrap" style={{ gap: 10, margin: '8px 0 2px' }}>
          {chips.length > 0 && (
            <div className="chips" style={{ flex: 1 }}>
              {chips.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  className={`chip ${picked.includes(c.type) ? 'on' : ''}`}
                  style={!c.expected && !picked.includes(c.type) ? { opacity: 0.55 } : undefined}
                  title={c.expected ? undefined : `Azure DevOps usually doesn't allow a ${c.type} as the parent of a ${parentFor.type}`}
                  onClick={() => toggleChip(c.type)}
                >
                  {c.type}
                </button>
              ))}
            </div>
          )}
          <label className="check small">
            <input type="checkbox" checked={projectOnly} onChange={(e) => setProjectOnly(e.target.checked)} /> This project only
          </label>
        </div>
      )}
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
        {parentFor && !loading && all.length === 0 && <div className="empty">No matching cards. Try another type or untick “This project only”.</div>}
        {!parentFor && !q && local.length === 0 && <div className="empty">Nothing assigned to you is open. Type to search everything.</div>}
      </div>
      <div className="small faint">↑↓ to move · Enter to pick · Esc to close</div>
    </Modal>
  )
}
