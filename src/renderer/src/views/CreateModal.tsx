import { useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import type { Route } from '@shared/types'
import { call } from '../api'
import { Modal, ModalHead, TypeChip, useApp, useAutoFocus } from '../components'
import { PickModal } from './PickModal'

const PREFERRED = ['Task', 'Bug', 'User Story', 'Product Backlog Item', 'Issue', 'Feature', 'Epic']

export function CreateModal({ route, onClose }: { route: Extract<Route, { view: 'create' }>; onClose: () => void }): ReactNode {
  const { types, settings, state, toast, openItem } = useApp()
  const p = route.prefill ?? {}
  const ordered = [...types].sort((a, b) => {
    const ia = PREFERRED.indexOf(a.name)
    const ib = PREFERRED.indexOf(b.name)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const [type, setType] = useState(p.type && types.some((t) => t.name === p.type) ? p.type : ordered[0]?.name ?? 'Task')
  const [title, setTitle] = useState(p.title ?? '')
  const [description, setDescription] = useState(p.description ?? '')
  const [parentId, setParentId] = useState<number | undefined>(p.parentId)
  const [parentTitle, setParentTitle] = useState('')
  const [tags, setTags] = useState((p.tags ?? []).join(', '))
  const [remaining, setRemaining] = useState<string>(p.remainingWork != null ? String(p.remainingWork) : '')
  const [assignToMe, setAssignToMe] = useState(p.assignToMe ?? true)
  const [currentIteration, setCurrentIteration] = useState(p.currentIteration ?? !!settings.team)
  const [startFocus, setStartFocus] = useState(p.startFocus ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pickingParent, setPickingParent] = useState(false)
  const titleRef = useAutoFocus<HTMLInputElement>()

  const fromUnplanned = route.fromUnplanned ? state.unplanned.find((u) => u.id === route.fromUnplanned) : undefined
  const isTask = /task/i.test(type)

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true)
    setError('')
    try {
      const item = await call('createItem', {
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        parentId,
        assignToMe,
        currentIteration,
        tags: tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        remainingWork: isTask && remaining ? Number(remaining) : undefined,
        startFocus,
        fromUnplanned: route.fromUnplanned,
        fromInbox: route.fromInbox
      })
      toast(`Created #${item.id}`, { action: { label: 'Open', run: () => openItem(item.id) } })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHead
        title="New work item"
        sub={fromUnplanned ? `Your unplanned time on “${fromUnplanned.text}” moves to this card.` : undefined}
        onClose={onClose}
      />
      <div className="seg">
        {ordered.map((t) => (
          <button key={t.name} className={type === t.name ? 'on' : ''} onClick={() => setType(t.name)}>
            <TypeChip type={t.name} showName={false} /> {t.name}
          </button>
        ))}
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && void submit()}
      >
        <label className="field">
          Title
          <input ref={titleRef} className="input" style={{ fontSize: 15 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short and specific" />
        </label>
        <label className="field">
          Description <span className="faint">(optional)</span>
          <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="row wrap" style={{ gap: 14, alignItems: 'end' }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Parent
            <div className="row">
              {parentId ? (
                <span className="pill accent ellipsis" style={{ maxWidth: 260 }}>
                  #{parentId} {parentTitle || state.titles[parentId]?.title || ''}
                  <X size={12} style={{ cursor: 'pointer' }} onClick={() => setParentId(undefined)} />
                </span>
              ) : (
                <span className="faint small">none</span>
              )}
              <button type="button" className="btn sm" onClick={() => setPickingParent(true)}>
                {parentId ? 'Change' : 'Choose…'}
              </button>
            </div>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            Tags
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" />
          </label>
          {isTask && (
            <label className="field" style={{ width: 110 }}>
              Estimate (h)
              <input className="input" type="number" min={0} step={0.5} value={remaining} onChange={(e) => setRemaining(e.target.value)} />
            </label>
          )}
        </div>
        <div className="row wrap" style={{ gap: 18 }}>
          <label className="check">
            <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> Assign to me
          </label>
          <label className="check" title={settings.team ? '' : 'Pick a team in Settings to use this'}>
            <input type="checkbox" disabled={!settings.team} checked={currentIteration} onChange={(e) => setCurrentIteration(e.target.checked)} /> Current sprint
          </label>
          {!route.fromUnplanned && (
            <label className="check">
              <input type="checkbox" checked={startFocus} onChange={(e) => setStartFocus(e.target.checked)} /> Start working on it now
            </label>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="faint small">Ctrl+Enter to create</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim() || busy}>
            {busy && <Loader2 size={15} className="spin" />} Create {type}
          </button>
        </div>
      </form>
      {pickingParent && (
        <PickModal
          title="Choose a parent"
          onClose={() => setPickingParent(false)}
          onPick={(item) => {
            setParentId(item.id)
            setParentTitle(item.title)
            setPickingParent(false)
          }}
        />
      )}
    </Modal>
  )
}
