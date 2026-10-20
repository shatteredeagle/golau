import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { ExternalLink, Play, X } from 'lucide-react'
import type { AppState, Route, Settings, TypeInfo, WorkItem } from '@shared/types'
import { daysSince, fmtDur } from '@shared/time'
import { call } from './api'

// ---------- app context ----------

export interface Ctx {
  state: AppState
  settings: Settings
  work: WorkItem[] | null
  workError: string
  refreshWork: (force?: boolean) => Promise<void>
  types: TypeInfo[]
  go: (r: Route) => void
  openItem: (id: number) => void
  toast: (msg: string, opts?: { action?: { label: string; run: () => void }; error?: boolean }) => void
  /** Update a card; if Azure DevOps wants more fields it asks for them. Resolves null if cancelled/failed. */
  updateItem: (item: { id: number; title: string }, fields: Record<string, unknown>) => Promise<WorkItem | null>
}

export const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = (): Ctx => useContext(AppCtx)

// ---------- small bits ----------

export function typeColor(types: TypeInfo[], type: string): string {
  return types.find((t) => t.name === type)?.color ?? '#7a8494'
}

export function TypeChip({ type, showName = true }: { type: string; showName?: boolean }): ReactNode {
  const { types } = useApp()
  return (
    <span className="type-chip" title={type}>
      <i style={{ background: typeColor(types, type) }} />
      {showName && type}
    </span>
  )
}

export function StatePill({ item }: { item: Pick<WorkItem, 'type' | 'state'> }): ReactNode {
  const { types } = useApp()
  const color = types.find((t) => t.name === item.type)?.states.find((s) => s.name === item.state)?.color ?? '#888'
  return (
    <span className="pill">
      <span className="dot" style={{ background: color === '#ffffff' ? '#aaa' : color }} />
      {item.state}
    </span>
  )
}

export function StaleBadge({ item }: { item: WorkItem }): ReactNode {
  const { settings } = useApp()
  const d = daysSince(item.changedDate)
  if (item.category !== 'InProgress' && item.category !== 'Resolved') return null
  if (d < settings.staleDays) return null
  return (
    <span className="pill warn" title="No updates on this card for a while">
      quiet {d}d
    </span>
  )
}

/** One-line card used in most lists. */
export function ItemRow({
  item,
  todayMs,
  right,
  onClick,
  dim,
  compact
}: {
  item: WorkItem
  todayMs?: number
  right?: ReactNode
  onClick?: () => void
  dim?: boolean
  /** narrow columns: drop the state pill */
  compact?: boolean
}): ReactNode {
  const { state, openItem } = useApp()
  const focused = state.focus?.itemId === item.id
  const done = item.category === 'Completed' || item.category === 'Removed'
  return (
    <div
      className={`item-row ${focused ? 'focused' : ''} ${done || dim ? 'done' : ''} ${compact ? 'compact' : ''}`}
      title={compact ? item.title : undefined}
      onClick={onClick ?? (() => openItem(item.id))}
    >
      <TypeChip type={item.type} showName={false} />
      <span className="id mono">{item.id}</span>
      <span className="title ellipsis">{item.title}</span>
      <StaleBadge item={item} />
      {todayMs ? <span className="pill accent mono">{fmtDur(todayMs)}</span> : null}
      {!compact && <StatePill item={item} />}
      {right}
      <OpenInAdo id={item.id} />
      {!done && <FocusButton item={item} />}
    </div>
  )
}

/** One click to the work item in Azure DevOps (default browser); doesn't open the drawer. */
export function OpenInAdo({ id, label }: { id: number; label?: boolean }): ReactNode {
  const open = (e: MouseEvent): void => {
    e.stopPropagation()
    void call('openInAdo', id)
  }
  return label ? (
    <button className="btn sm" title={`Open #${id} in Azure DevOps`} onClick={open}>
      <ExternalLink size={14} /> Open in ADO
    </button>
  ) : (
    <button className="icon-btn open-ado" title={`Open #${id} in Azure DevOps`} onClick={open}>
      <ExternalLink size={14} />
    </button>
  )
}

export function FocusButton({ item, big }: { item: WorkItem; big?: boolean }): ReactNode {
  const { state } = useApp()
  const start = useStartFocus()
  if (state.focus?.itemId === item.id) return big ? <span className="pill accent">In focus</span> : null
  return big ? (
    <button className="btn primary" onClick={() => start(item)}>
      <Play size={15} /> Work on this
    </button>
  ) : (
    <button
      className="icon-btn play"
      title="Work on this now"
      onClick={(e) => {
        e.stopPropagation()
        start(item)
      }}
    >
      <Play size={15} />
    </button>
  )
}

/**
 * Start focus on a card. If it's still in a "Proposed" state, offer (not force) moving it to the
 * first in-progress state, since starting work and updating the card should be one motion.
 */
export function useStartFocus(): (item: WorkItem) => Promise<void> {
  const { types, toast, updateItem } = useApp()
  return async (item: WorkItem) => {
    await call('focusItem', item.id)
    if (item.category === 'Proposed') {
      const next = types.find((t) => t.name === item.type)?.states.find((s) => s.category === 'InProgress')
      if (next)
        toast(`Move #${item.id} to ${next.name}?`, {
          action: {
            label: `Move to ${next.name}`,
            run: () =>
              void updateItem(item, { 'System.State': next.name }).then((w) => w && toast(`#${item.id} is ${next.name}`))
          }
        })
    }
  }
}

// Work item HTML is written by other people, so treat it as hostile:
// - links survive only as absolute http(s) URLs (no //host, relative or file: links, which would
//   resolve to Windows network paths from a file:// page)
// - images are replaced by a link: ADO images need auth anyway, and loading them could leak your
//   IP or, for //host paths, your Windows login hash
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    } else node.removeAttribute('href')
  }
})
/** Turn <img> into "[image]" links inside an inert document (DOMParser never fetches resources). */
function imagesToLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const a = doc.createElement('a')
    a.textContent = '[image]'
    const src = img.getAttribute('src') ?? ''
    if (/^https?:\/\//i.test(src)) a.setAttribute('href', src)
    img.replaceWith(a)
  }
  return doc.body.innerHTML
}

export function Html({ html }: { html?: string }): ReactNode {
  if (!html) return <div className="faint small">Nothing here.</div>
  const clean = DOMPurify.sanitize(imagesToLinks(html), {
    FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math', 'video', 'audio', 'source', 'picture', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset', 'background', 'poster', 'formaction'],
    ALLOW_DATA_ATTR: false
  })
  return <div className="html" dangerouslySetInnerHTML={{ __html: clean }} />
}

export function Modal({
  children,
  onClose,
  wide
}: {
  children: ReactNode
  onClose: () => void
  wide?: boolean
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      // only the top-most modal reacts
      const all = document.querySelectorAll('.overlay')
      if (e.key === 'Escape' && all[all.length - 1] === ref.current) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div ref={ref} className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
}

export function ModalHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }): ReactNode {
  return (
    <>
      <div className="row">
        <h2>{title}</h2>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {sub && <div className="sub">{sub}</div>}
    </>
  )
}

export function Steps({ n, at }: { n: number; at: number }): ReactNode {
  return (
    <div className="steps">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i <= at ? 'on' : ''} />
      ))}
    </div>
  )
}

/** Debounced value */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useAutoFocus<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 30)
  }, [])
  return ref
}

/** Groups my work into the four columns used across the app. */
export function bucket(items: WorkItem[]): Record<'todo' | 'doing' | 'review' | 'done', WorkItem[]> {
  const out = { todo: [] as WorkItem[], doing: [] as WorkItem[], review: [] as WorkItem[], done: [] as WorkItem[] }
  for (const i of items) {
    if (i.category === 'Proposed') out.todo.push(i)
    else if (i.category === 'InProgress') out.doing.push(i)
    else if (i.category === 'Resolved') out.review.push(i)
    else if (i.category === 'Completed') out.done.push(i)
  }
  return out
}
