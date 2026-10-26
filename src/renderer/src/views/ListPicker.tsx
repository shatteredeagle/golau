import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, ModalHead, useAutoFocus } from '../components'

export interface Choice {
  key: string
  label: string
  /** smaller text after the label (email, sprint dates...) */
  sub?: string
  /** small badge, e.g. "current" */
  badge?: string
}

/**
 * Pick one thing from a list that loads when it opens (people, sprints, areas). Type to filter, arrows + Enter.
 * `top` rows (Me, Unassigned) come first and are always shown.
 */
export function ListPicker({
  title,
  placeholder,
  load,
  top = [],
  current,
  onPick,
  onClose
}: {
  title: string
  placeholder: string
  load: () => Promise<Choice[]>
  top?: Choice[]
  /** key of what is set now: ticked, not hidden */
  current?: string
  onPick: (c: Choice) => Promise<void> | void
  onClose: () => void
}): ReactNode {
  const [items, setItems] = useState<Choice[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [kb, setKb] = useState(0)
  const input = useAutoFocus<HTMLInputElement>()

  useEffect(() => {
    let live = true
    load()
      .then((x) => live && setItems(x))
      .catch((e: Error) => live && (setError(e.message), setItems([])))
    return () => {
      live = false
    }
  }, [])

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (c: Choice): boolean => words.every((w) => `${c.label} ${c.sub ?? ''}`.toLowerCase().includes(w))
    return [...top.filter(hit), ...(items ?? []).filter(hit)]
  }, [items, q, top])

  useEffect(() => setKb(0), [q])

  const choose = async (c: Choice): Promise<void> => {
    await onPick(c)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <ModalHead title={title} onClose={onClose} />
      <input
        ref={input}
        className="input"
        style={{ fontSize: 16, padding: '10px 12px' }}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setKb((k) => Math.min(rows.length - 1, k + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setKb((k) => Math.max(0, k - 1))
          } else if (e.key === 'Enter' && rows[kb]) {
            e.preventDefault()
            void choose(rows[kb])
          }
        }}
      />
      <div className="pick-list">
        {items === null && (
          <div className="empty">
            <Loader2 size={14} className="spin" /> Loading…
          </div>
        )}
        {rows.map((c, i) => (
          <div key={`${i}:${c.key}`} className={`pick ${kb === i ? 'kb' : ''}`} onMouseEnter={() => setKb(i)} onClick={() => void choose(c)}>
            <span className="ellipsis" style={{ flex: 1 }}>
              {c.key === current ? '✓ ' : ''}
              {c.label}
              {c.sub && <span className="faint small"> {c.sub}</span>}
            </span>
            {c.badge && <span className="pill accent">{c.badge}</span>}
          </div>
        ))}
        {items !== null && rows.length === 0 && <div className="empty">{error || 'Nothing matches.'}</div>}
      </div>
      <div className="small faint">↑↓ to move · Enter to pick · Esc to close</div>
    </Modal>
  )
}
