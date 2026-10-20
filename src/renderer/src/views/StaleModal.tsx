import { useState, type ReactNode } from 'react'
import { Check, MessageSquare, Undo2 } from 'lucide-react'
import type { WorkItem } from '@shared/types'
import { daysSince } from '@shared/time'
import { staleItems } from '@shared/stale'
import { call } from '../api'
import { Modal, ModalHead, StatePill, TypeChip, useApp } from '../components'

/** One-click triage for cards that haven't moved: still on it / back to to-do / done. */
export function StaleModal({ onClose }: { onClose: () => void }): ReactNode {
  const { work, settings, types, toast, openItem } = useApp()
  const [handled, setHandled] = useState<Record<number, string>>({})
  const stale = staleItems(work ?? [], settings.staleDays)
  // keep handled ones visible so the list doesn't jump around
  const [list] = useState<WorkItem[]>(stale)

  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [noteText, setNoteText] = useState('')

  const act = async (item: WorkItem, kind: 'still' | 'todo' | 'done'): Promise<void> => {
    const t = types.find((x) => x.name === item.type)
    try {
      if (kind === 'still') {
        await call('addComment', item.id, noteText.trim() || 'Still in progress.', item.project)
        setNoteFor(null)
        setNoteText('')
        setHandled((h) => ({ ...h, [item.id]: 'updated' }))
      } else {
        const target = t?.states.find((s) => s.category === (kind === 'todo' ? 'Proposed' : 'Completed'))
        if (!target) throw new Error(`No ${kind} state for ${item.type}`)
        await call('updateItem', item.id, { 'System.State': target.name })
        setHandled((h) => ({ ...h, [item.id]: target.name }))
      }
    } catch (e) {
      toast((e as Error).message, { error: true })
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <ModalHead
        title="Cards that have gone quiet"
        sub={`In progress with no changes for ${settings.staleDays}+ days. One click each, no essays needed.`}
        onClose={onClose}
      />
      {list.length === 0 ? (
        <div className="empty">Nothing stale. Everything's moving.</div>
      ) : (
        <div className="list">
          {list.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 4 }}>
            <div className={`item-row ${handled[i.id] ? 'done' : ''}`} style={{ cursor: 'default' }}>
              <TypeChip type={i.type} showName={false} />
              <span className="id mono">{i.id}</span>
              <span className="title ellipsis" style={{ cursor: 'pointer' }} onClick={() => openItem(i.id)}>
                {i.title}
              </span>
              <span className="pill warn">{daysSince(i.changedDate)}d</span>
              <StatePill item={i} />
              {handled[i.id] ? (
                <span className="pill good">
                  <Check size={12} /> {handled[i.id]}
                </span>
              ) : (
                <>
                  <button className="btn sm" title="Post a short update" onClick={() => setNoteFor(noteFor === i.id ? null : i.id)}>
                    <MessageSquare size={13} /> Still on it
                  </button>
                  <button className="btn sm" title="Not actually working on it" onClick={() => void act(i, 'todo')}>
                    <Undo2 size={13} /> Back to to-do
                  </button>
                  <button className="btn sm" onClick={() => void act(i, 'done')}>
                    <Check size={13} /> Done
                  </button>
                </>
              )}
            </div>
            {noteFor === i.id && !handled[i.id] && (
              <form
                className="row"
                style={{ paddingLeft: 36 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void act(i, 'still')
                }}
              >
                <input autoFocus className="input" placeholder="Short update (optional), e.g. waiting on review from Sam" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                <button className="btn primary sm">Post</button>
              </form>
            )}
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
