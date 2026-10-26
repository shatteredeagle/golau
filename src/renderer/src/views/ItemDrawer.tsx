import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Loader2, Plus, UserCheck, X } from 'lucide-react'
import type { Comment, FieldSpec, WorkItem } from '@shared/types'
import { ago, fmtDur, itemTotal, todayTotals } from '@shared/time'
import { call } from '../api'
import { FocusButton, Html, OpenInAdo, StaleBadge, TypeChip, useApp } from '../components'
import { FieldEditor, timeEstimateSpec } from '../fields'
import { PickModal } from './PickModal'

export function ItemDrawer({ id, onClose }: { id: number; onClose: () => void }): ReactNode {
  const { types, state, toast, go, openItem, updateItem } = useApp()
  const [item, setItem] = useState<WorkItem | null>(null)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [me, setMe] = useState<string>('')
  const [error, setError] = useState('')
  const [update, setUpdate] = useState('')
  const [posting, setPosting] = useState(false)
  const [estimateSpec, setEstimateSpec] = useState<FieldSpec>()
  const [pickingParent, setPickingParent] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const it = await call('getItem', id)
      setItem(it)
      void call('typeFields', it.type, it.project)
        .then((specs) => setEstimateSpec(timeEstimateSpec(specs)))
        .catch(() => setEstimateSpec(undefined))
      setComments(await call('getComments', id, it.project))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void load()
    void call('me').then((m) => setMe(m.email ?? m.name)).catch(() => undefined)
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [id])

  const save = async (fields: Record<string, unknown>, msg?: string): Promise<void> => {
    const it = await updateItem({ id, title: item?.title ?? `#${id}` }, fields)
    if (!it) return
    setItem({ ...it, description: item?.description, acceptanceCriteria: item?.acceptanceCriteria })
    if (msg) toast(msg)
  }

  const setParent = (parentId: number | null): Promise<void> =>
    save({ $parent: parentId }, parentId === null ? 'Parent removed' : `Parent set to #${parentId}`)

  const post = async (): Promise<void> => {
    if (!update.trim() || !item) return
    setPosting(true)
    try {
      await call('addComment', id, update.trim(), item.project)
      setUpdate('')
      setComments(await call('getComments', id, item.project))
    } catch (e) {
      toast((e as Error).message, { error: true })
    } finally {
      setPosting(false)
    }
  }

  const typeInfo = types.find((t) => t.name === item?.type)
  const note = state.notes[id]?.text ?? ''
  const today = todayTotals(state).get(String(id)) ?? 0
  const total = itemTotal(state, id)
  const mine = !!item?.assignedTo?.email && item.assignedTo.email.toLowerCase() === me.toLowerCase()

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div className="row">
          {item ? <TypeChip type={item.type} /> : <span className="faint">Loading…</span>}
          <span className="faint mono small">#{id}</span>
          <button
            className="icon-btn"
            title="Copy link"
            onClick={() => item && void call('copyText', item.webUrl).then(() => toast('Link copied'))}
          >
            <Copy size={14} />
          </button>
          <span className="spacer" />
          {item && <OpenInAdo id={item.id} label />}
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {item && (
          <textarea
            className="title-edit"
            rows={Math.min(4, Math.max(1, Math.ceil(item.title.length / 42)))}
            defaultValue={item.title}
            key={item.rev}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== item.title) void save({ 'System.Title': v }, 'Title saved')
            }}
          />
        )}
        {item && (
          <div className="row wrap">
            {item.category !== 'Completed' && item.category !== 'Removed' && <FocusButton item={item} big />}
            {typeInfo && (
              <select className="select inline" value={item.state} onChange={(e) => void save({ 'System.State': e.target.value }, `→ ${e.target.value}`)}>
                {typeInfo.states.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            )}
            <StaleBadge item={item} />
          </div>
        )}
      </div>

      <div className="drawer-body">
        {error && <div className="error">{error}</div>}
        {!item && !error && <Loader2 className="spin" />}
        {item && (
          <>
            <dl className="props">
              <dt>Assigned</dt>
              <dd className="row">
                <span className="ellipsis">{item.assignedTo?.name ?? <span className="faint">Unassigned</span>}</span>
                {!mine && (
                  <button
                    className="btn sm"
                    onClick={() =>
                      void call('assignToMe', id)
                        .then((it) => {
                          setItem({ ...it, description: item.description })
                          toast('Assigned to you')
                        })
                        .catch((e: Error) => toast(e.message, { error: true }))
                    }
                  >
                    <UserCheck size={13} /> Take it
                  </button>
                )}
              </dd>
              {item.iterationPath && (
                <>
                  <dt>Iteration</dt>
                  <dd className="ellipsis">{item.iterationPath}</dd>
                </>
              )}
              <dt>Parent</dt>
              <dd className="row">
                {item.parentId ? (
                  <a href="#" className="ellipsis" onClick={(e) => { e.preventDefault(); openItem(item.parentId!) }}>
                    #{item.parentId} {state.titles[item.parentId]?.title ?? ''}
                  </a>
                ) : (
                  <span className="faint">none</span>
                )}
                <button className="btn sm" onClick={() => setPickingParent(true)}>
                  {item.parentId ? 'Change' : 'Add parent'}
                </button>
                {item.parentId && (
                  <button className="btn sm" title="Remove the parent link" onClick={() => void setParent(null)}>
                    <X size={12} />
                  </button>
                )}
              </dd>
              {item.tags.length > 0 && (
                <>
                  <dt>Tags</dt>
                  <dd className="row wrap">
                    {item.tags.map((t) => (
                      <span key={t} className="pill">
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {estimateSpec && (
                <>
                  <dt>{estimateSpec.name}</dt>
                  <dd>
                    <FieldEditor
                      spec={estimateSpec}
                      value={item.timeEstimate}
                      onSave={(v) => void save({ [estimateSpec.referenceName]: v }, `${estimateSpec.name} saved`)}
                    />
                  </dd>
                </>
              )}
              {item.remainingWork != null && (
                <>
                  <dt>Remaining (h)</dt>
                  <dd>
                    <NumberField value={item.remainingWork} onSave={(v) => void save({ 'Microsoft.VSTS.Scheduling.RemainingWork': v }, 'Remaining work saved')} />
                  </dd>
                </>
              )}
              {item.completedWork != null && (
                <>
                  <dt>Completed (h)</dt>
                  <dd>
                    <NumberField value={item.completedWork} onSave={(v) => void save({ 'Microsoft.VSTS.Scheduling.CompletedWork': v }, 'Completed work saved')} />
                  </dd>
                </>
              )}
              <dt>Your time</dt>
              <dd className="muted">
                {total ? `${fmtDur(today)} today · ${fmtDur(total)} total` : 'none tracked yet'}
              </dd>
              <dt>Changed</dt>
              <dd className="muted">{ago(item.changedDate)}</dd>
            </dl>

            <label className="field">
              Where I'm at / next step <span className="faint">(private)</span>
              <input
                className="input"
                defaultValue={note}
                placeholder="Breadcrumb for future you"
                onBlur={(e) => e.target.value !== note && void call('setNote', id, e.target.value)}
              />
            </label>

            <section>
              <div className="section-title">Description</div>
              <Html html={item.description} />
              {item.acceptanceCriteria && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>Acceptance criteria</div>
                  <Html html={item.acceptanceCriteria} />
                </>
              )}
            </section>

            <section className="stack" style={{ gap: 8 }}>
              <div className="section-title" style={{ margin: 0 }}>Updates</div>
              <textarea
                className="textarea"
                rows={2}
                placeholder="Post an update (Ctrl+Enter)"
                value={update}
                onChange={(e) => setUpdate(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && void post()}
              />
              <div className="row">
                <button className="btn sm primary" disabled={!update.trim() || posting} onClick={() => void post()}>
                  Post
                </button>
                <span className="spacer" />
                <button className="btn sm" onClick={() => go({ view: 'create', prefill: { parentId: id, type: 'Task' } })}>
                  <Plus size={13} /> Child task
                </button>
              </div>
              {comments === null ? (
                <Loader2 className="spin" size={16} />
              ) : comments.length === 0 ? (
                <div className="faint small">No updates yet.</div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="comment">
                    <div className="who">
                      {c.createdBy} · {ago(c.createdDate)}
                    </div>
                    <Html html={c.text} />
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
      {pickingParent && item && (
        <PickModal
          title="Choose a parent"
          parentFor={{ type: item.type, itemId: id, currentParentId: item.parentId }}
          onClose={() => setPickingParent(false)}
          onPick={async (p) => {
            setPickingParent(false)
            await setParent(p.id)
          }}
        />
      )}
    </aside>
  )
}

function NumberField({ value, onSave }: { value: number; onSave: (v: number) => void }): ReactNode {
  return (
    <input
      className="input"
      style={{ width: 90, padding: '3px 8px' }}
      type="number"
      min={0}
      step={0.5}
      defaultValue={value}
      onBlur={(e) => {
        const v = Number(e.target.value)
        if (!Number.isNaN(v) && v !== value) onSave(v)
      }}
    />
  )
}
