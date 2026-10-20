import type { ReactNode } from 'react'
import { ArrowLeftRight, Coffee, Pause, Play, Square } from 'lucide-react'
import { fmtClock } from '@shared/time'
import { call, useNow } from '../api'
import { OpenInAdo, useApp } from '../components'

/** Always-visible strip at the top of the main window: what you're on, how long, quick controls. */
export function FocusBar({ onSwitch }: { onSwitch: () => void }): ReactNode {
  const { state, openItem } = useApp()
  const now = useNow()
  const f = state.focus
  const p = state.paused

  if (!f && !p)
    return (
      <div className="focusbar">
        <span className="light" />
        <div className="what">
          <span className="t muted">Nothing in focus</span>
        </div>
        <button className="btn primary" onClick={onSwitch}>
          <Play size={15} /> What are you working on? <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>Ctrl K</span>
        </button>
      </div>
    )

  if (!f && p)
    return (
      <div className="focusbar">
        <span className="light" />
        <div className="what">
          <span className="small faint">{p.reason === 'break' ? 'On a break' : p.reason === 'idle' ? 'Paused while you were away' : 'Paused'}</span>
          <span className="t ellipsis">
            {p.focus.itemId ? `#${p.focus.itemId} ` : ''}
            {p.focus.title}
          </span>
        </div>
        <button className="btn primary" onClick={() => void call('resume')}>
          <Play size={15} /> Resume
        </button>
        <button className="btn" onClick={onSwitch}>
          <ArrowLeftRight size={15} /> Switch
        </button>
        <button className="icon-btn" title="Stop tracking" onClick={() => void call('stopFocus')}>
          <Square size={15} />
        </button>
      </div>
    )

  const unplanned = !f!.itemId
  return (
    <div className="focusbar">
      <span className={`light on ${unplanned ? 'unplanned' : ''}`} />
      <div className="what" style={{ cursor: f!.itemId ? 'pointer' : 'default' }} onClick={() => f!.itemId && openItem(f!.itemId)}>
        <span className="small faint">{unplanned ? 'Unplanned (no card yet)' : `Working on #${f!.itemId}`}</span>
        <span className="t ellipsis">{f!.title}</span>
      </div>
      {f!.itemId && <OpenInAdo id={f!.itemId} />}
      <span className="clock mono">{fmtClock(now - f!.startedAt)}</span>
      <button className="icon-btn" title="Pause" onClick={() => void call('pause')}>
        <Pause size={17} />
      </button>
      <button className="icon-btn" title="Take a break" onClick={() => void call('takeBreak')}>
        <Coffee size={17} />
      </button>
      <button className="btn" onClick={onSwitch}>
        <ArrowLeftRight size={15} /> Switch
      </button>
    </div>
  )
}
