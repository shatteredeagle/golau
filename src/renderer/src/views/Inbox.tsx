import { useState, type ReactNode } from 'react'
import { Check, MessageSquarePlus, Play, Plus, Undo2 } from 'lucide-react'
import { ago } from '@shared/time'
import { call } from '../api'
import { useApp } from '../components'
import { PickModal } from './PickModal'

/** Brain-dump inbox: park thoughts now, sort them when you have the bandwidth. */
export function Inbox(): ReactNode {
  const { state, go, toast, settings } = useApp()
  const [text, setText] = useState('')
  const [commenting, setCommenting] = useState<{ id: string; text: string } | null>(null)
  const [showDone, setShowDone] = useState(false)
  const open = state.inbox.filter((x) => !x.done).reverse()
  const done = state.inbox.filter((x) => x.done).reverse().slice(0, 20)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <div className="muted small">
            Thoughts you parked. Capture from anywhere with <span className="kbd">{settings.captureHotkey.replace('CommandOrControl', 'Ctrl')}</span>
          </div>
        </div>
      </div>
      <form
        style={{ marginBottom: 18 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) void call('addInbox', text).then(() => setText(''))
        }}
      >
        <input className="input" style={{ fontSize: 15, height: 42 }} placeholder="Park a thought… (Enter)" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
      {open.length === 0 ? (
        <div className="empty">Inbox zero. Your brain thanks you.</div>
      ) : (
        <div className="list">
          {open.map((e) => (
            <div key={e.id} className="item-row" style={{ cursor: 'default' }}>
              <span className="title">{e.text}</span>
              <span className="small faint">{ago(new Date(e.createdAt).toISOString())}</span>
              <button className="btn sm" title="Make it a work item" onClick={() => go({ view: 'create', prefill: { title: e.text }, fromInbox: e.id })}>
                <Plus size={13} /> Card
              </button>
              <button className="btn sm" title="Add it as an update on an existing card" onClick={() => setCommenting(e)}>
                <MessageSquarePlus size={13} /> Add to card
              </button>
              <button
                className="btn sm"
                title="Start tracking this as unplanned work"
                onClick={() => {
                  void call('focusUnplanned', e.text)
                  void call('resolveInbox', e.id, 'dismissed')
                }}
              >
                <Play size={13} /> Do now
              </button>
              <button className="icon-btn" title="Done / not needed" onClick={() => void call('resolveInbox', e.id, 'dismissed')}>
                <Check size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <button className="btn ghost sm" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} recently cleared ({done.length})
          </button>
          {showDone && (
            <div className="list" style={{ marginTop: 8 }}>
              {done.map((e) => (
                <div key={e.id} className="item-row done" style={{ cursor: 'default' }}>
                  <span className="title">{e.text}</span>
                  {e.done?.itemId && <span className="pill">#{e.done.itemId}</span>}
                  <button className="icon-btn" title="Put back" onClick={() => void call('restoreInbox', e.id)}>
                    <Undo2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {commenting && (
        <PickModal
          title="Add to which card?"
          onClose={() => setCommenting(null)}
          onPick={async (item) => {
            await call('addComment', item.id, commenting.text, item.project)
            await call('resolveInbox', commenting.id, 'comment', item.id)
            toast(`Added to #${item.id}`)
            setCommenting(null)
          }}
        />
      )}
    </>
  )
}
