import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Inbox, Pause, Play, X, Zap } from 'lucide-react'
import type { Nudge, Settings } from '@shared/types'
import { fmtClock } from '@shared/time'
import { call, on, useAppState, useNow, useSettings } from './api'

function useTheme(settings: Settings | null): void {
  useEffect(() => {
    const t = settings?.theme ?? 'system'
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [settings?.theme])
}

/** Corner check-in card. */
export function NudgeSurface(): ReactNode {
  const settings = useSettings()
  useTheme(settings)
  const [n, setN] = useState<Nudge | null>(null)
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = on<Nudge>('nudge', (x) => {
      setN(x)
      setText('')
    })
    window.tl.send('nudge-ready')
    return off
  }, [])

  // size the window to the card
  useLayoutEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(() => void call('nudgeResize', (box.current?.offsetHeight ?? 200) + 14))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [n?.id])

  if (!n) return null
  const act = (id: string, payload: { text?: string; itemId?: number } = {}): void => {
    void call('nudgeAction', n.id, id, payload)
    setN(null)
  }
  const wantsInput = !!n.data?.input

  return (
    <div className="nudge" ref={box}>
      <div className="head">
        <b>{n.title}</b>
        <button className="icon-btn" title="Later" onClick={() => act(n.actions.find((a) => a.onTimeout)?.id ?? 'dismiss')}>
          <X size={16} />
        </button>
      </div>
      {n.body && <div className="body">{n.body}</div>}
      {n.suggestions && n.suggestions.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small faint">Maybe one of these?</span>
          {n.suggestions.map((s) => (
            <button key={s.id} className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => act('link', { itemId: s.id })}>
              <span className="faint mono">#{s.id}</span>
              <span className="ellipsis">{s.title}</span>
            </button>
          ))}
        </div>
      )}
      {wantsInput && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) act('unplanned', { text })
          }}
        >
          <input className="input" placeholder="Type what you're doing + Enter to track it" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
      )}
      <div className="actions">
        {n.actions
          .filter((a) => !(wantsInput && a.id === 'unplanned' && !text.trim()))
          .map((a) => (
            <button key={a.id} className={`btn sm ${a.primary ? 'primary' : ''}`} onClick={() => act(a.id, { text })}>
              {a.label}
            </button>
          ))}
      </div>
      {n.timeout && (
        <div key={n.id} className="timer" style={{ width: '100%', animation: `shrink ${n.timeout}s linear forwards` }} />
      )}
      <style>{'@keyframes shrink { to { transform: scaleX(0) } }'}</style>
    </div>
  )
}

/** Floating always-on-top focus pill. */
export function MiniSurface(): ReactNode {
  const state = useAppState()
  const settings = useSettings()
  useTheme(settings)
  const now = useNow()
  if (!state) return null
  const f = state.focus
  const p = state.paused
  const ref = f ?? p?.focus
  if (!ref) return null
  const color = !f ? 'var(--faint)' : f.itemId ? 'var(--accent)' : 'var(--amber)'
  return (
    <div className="mini" onDoubleClick={() => void call('showMain', ref.itemId ? { view: 'item', id: ref.itemId } : { view: 'today' })}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: color, flex: 'none', boxShadow: f ? `0 0 10px ${color}` : 'none' }} />
      <span className="t ellipsis" title={ref.title}>
        {ref.itemId ? <span className="faint mono">#{ref.itemId} </span> : !f ? '' : <Zap size={12} style={{ color: 'var(--amber)', verticalAlign: -1 }} />}
        {ref.title}
      </span>
      <span className="clock mono">{f ? fmtClock(now - f.startedAt) : 'paused'}</span>
      {f ? (
        <button className="icon-btn" title="Pause" onClick={() => void call('pause')}>
          <Pause size={15} />
        </button>
      ) : (
        <button className="icon-btn" title="Resume" onClick={() => void call('resume')}>
          <Play size={15} />
        </button>
      )}
      <button className="icon-btn" title="Switch task" onClick={() => void call('showMain', { view: 'pick' })}>
        <ArrowLeftRight size={15} />
      </button>
    </div>
  )
}

/** Global-hotkey brain dump. Enter = inbox, Ctrl+Enter = start tracking it now. */
export function CaptureSurface(): ReactNode {
  const settings = useSettings()
  useTheme(settings)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(
    () =>
      on('capture-open', () => {
        setText('')
        setTimeout(() => input.current?.focus(), 20)
      }),
    []
  )
  return (
    <div className="capture">
      <input
        ref={input}
        autoFocus
        placeholder="What's on your mind?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') void call('hideCapture')
          if (e.key === 'Enter' && text.trim()) void call('captureSubmit', text, e.ctrlKey ? 'track' : 'inbox')
        }}
      />
      <div className="row small faint">
        <Inbox size={13} /> Enter: park it in the inbox
        <span style={{ width: 10 }} />
        <Zap size={13} /> Ctrl+Enter: start tracking it now
        <span className="spacer" />
        Esc
      </div>
    </div>
  )
}
