import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Loader2, Plus, RefreshCw, UserCheck, X } from 'lucide-react'
import type { Comment, FieldSpec, WorkItem } from '@shared/types'
import { ago, fmtDur, itemTotal, todayTotals } from '@shared/time'
import { call, REFRESH_EVENT } from '../api'
import { FocusButton, Html, OpenInAdo, StaleBadge, TypeChip, useApp } from '../components'
import { FieldEditor, timeEstimateSpec } from '../fields'
import { PickModal } from './PickModal'
import { ListPicker, type Choice } from './ListPicker'
import { addTags, joinTags, numberOrNull } from '@shared/edit'

export function ItemDrawer({ id, onClose }: { id: number; onClose: () => void }): ReactNode {
  const { types, state, toast, go, openItem, updateItem, refreshWork } = useApp()
  const [item, setItem] = useState<WorkItem | null>(null)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [me, setMe] = useState<string>('')
  const [error, setError] = useState('')
  const [update, setUpdate] = useState('')
  const [posting, setPosting] = useState(false)
  const [estimateSpec, setEstimateSpec] = useState<FieldSpec>()
  const [pickingParent, setPickingParent] = useState(false)
  const [picker, setPicker] = useState<'assignee' | 'iteration' | 'area' | null>(null)
  const [specs, setSpecs] = useState<FieldSpec[]>([])
  const [tagIdeas, setTagIdeas] = useState<string[]>([])
  const [tagText, setTagText] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [parentTitle, setParentTitle] = useState<{ id: number; title: string }>()

  const load = async (): Promise<void> => {
    try {
      const it = await call('getItem', id)
      setItem(it)
      void call('typeFields', it.type, it.project)
        .then((s) => {
          setSpecs(s)
          setEstimateSpec(timeEstimateSpec(s))
        })
        .catch(() => {
          setSpecs([])
          setEstimateSpec(undefined)
        })
      setComments(await call('getComments', id, it.project))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Re-read the card (and the My work list) from Azure DevOps, e.g. after changing it there. */
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all([load(), refreshWork(true)])
    } finally {
      setRefreshing(false)
    }
  }

  // F5, and coming back to the window, re-read the card: Azure DevOps is the source of truth
  useEffect(() => {
    const h = (): void => {
      if (!document.querySelector('.overlay')) void load()
    }
    window.addEventListener(REFRESH_EVENT, h)
    return () => window.removeEventListener(REFRESH_EVENT, h)
  }, [id])

  // a parent set outside Golau isn't in the title cache: look it up
  const parentId = item?.parentId
  useEffect(() => {
    if (!parentId || state.titles[parentId]) return setParentTitle(undefined)
    let live = true
    void call('getItem', parentId)
      .then((p) => live && setParentTitle({ id: p.id, title: p.title }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [parentId])

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
    setItem(it)
    if (msg) toast(msg)
  }

  const has = (ref: string): boolean => specs.some((x) => x.referenceName === ref)
  const saveTags = (tags: string[]): Promise<void> => save({ 'System.Tags': tags.length ? joinTags(tags) : null }, 'Tags saved')
  const people = async (): Promise<Choice[]> =>
    (await call('people')).map((p) => ({ key: p.email ?? p.name, label: p.name, sub: p.email }))
  const sprints = async (): Promise<Choice[]> =>
    (await call('iterations', item?.project)).map((i) => ({ key: i.path, label: i.name, sub: i.path === i.name ? undefined : i.path, badge: i.timeFrame === 'current' ? 'current' : undefined }))
  const areas = async (): Promise<Choice[]> => (await call('areas', item?.project)).map((i) => ({ key: i.path, label: i.path }))

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
          <button className="icon-btn" title="Refresh from Azure DevOps" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
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
                  <button className="btn sm" onClick={() => void save({ 'System.AssignedTo': me }, 'Assigned to you')}>
                    <UserCheck size={13} /> Take it
                  </button>
                )}
                <button className="btn sm" onClick={() => setPicker('assignee')}>
                  Change
                </button>
              </dd>
              <dt>Iteration</dt>
              <dd className="row">
                <span className="ellipsis">{item.iterationPath ?? <span className="faint">none</span>}</span>
                <button className="btn sm" onClick={() => setPicker('iteration')}>
                  Change
                </button>
              </dd>
              <dt>Area</dt>
              <dd className="row">
                <span className="ellipsis">{item.areaPath ?? <span className="faint">none</span>}</span>
                <button className="btn sm" onClick={() => setPicker('area')}>
                  Change
                </button>
              </dd>
              <dt>Parent</dt>
              <dd className="row">
                {item.parentId ? (
                  <a href="#" className="ellipsis" onClick={(e) => { e.preventDefault(); openItem(item.parentId!) }}>
                    #{item.parentId} {state.titles[item.parentId]?.title ?? (parentTitle?.id === item.parentId ? parentTitle.title : '')}
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
              <dt>Tags</dt>
              <dd className="row wrap">
                {item.tags.map((t) => (
                  <span key={t} className="pill">
                    {t}
                    <X size={11} style={{ cursor: 'pointer' }} onClick={() => void saveTags(item.tags.filter((x) => x !== t))} />
                  </span>
                ))}
                <input
                  className="input"
                  style={{ width: 120, padding: '2px 8px' }}
                  list="tag-ideas"
                  placeholder="add tag"
                  value={tagText}
                  onFocus={() => tagIdeas.length || void call('tags', item.project).then(setTagIdeas).catch(() => undefined)}
                  onChange={(e) => setTagText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      const next = addTags(item.tags, tagText)
                      setTagText('')
                      if (next.length !== item.tags.length) void saveTags(next)
                    }
                  }}
                />
                <datalist id="tag-ideas">
                  {tagIdeas.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </dd>
              {has('Microsoft.VSTS.Common.Priority') && (
                <>
                  <dt>Priority</dt>
                  <dd>
                    <select
                      className="select inline"
                      value={item.priority ?? ''}
                      onChange={(e) => void save({ 'Microsoft.VSTS.Common.Priority': e.target.value ? Number(e.target.value) : null }, 'Priority saved')}
                    >
                      <option value="">none</option>
                      {(specs.find((x) => x.referenceName === 'Microsoft.VSTS.Common.Priority')?.allowedValues?.map(Number) ?? [1, 2, 3, 4]).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
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
              {(item.remainingWork != null || has('Microsoft.VSTS.Scheduling.RemainingWork')) && (
                <>
                  <dt>Remaining (h)</dt>
                  <dd>
                    <NumberField value={item.remainingWork} onSave={(v) => void save({ 'Microsoft.VSTS.Scheduling.RemainingWork': v }, 'Remaining work saved')} />
                  </dd>
                </>
              )}
              {(item.completedWork != null || has('Microsoft.VSTS.Scheduling.CompletedWork')) && (
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
      {picker === 'assignee' && item && (
        <ListPicker
          title="Assign to"
          placeholder="Search people by name or email"
          load={people}
          top={[
            { key: me, label: 'Me', sub: me },
            { key: '', label: 'Unassigned' }
          ]}
          current={item.assignedTo?.email ?? ''}
          onClose={() => setPicker(null)}
          onPick={(c) => save({ 'System.AssignedTo': c.key || null }, c.key ? `Assigned to ${c.label === 'Me' ? 'you' : c.label}` : 'Unassigned')}
        />
      )}
      {picker === 'iteration' && item && (
        <ListPicker
          title="Move to sprint"
          placeholder="Search sprints"
          load={sprints}
          current={item.iterationPath}
          onClose={() => setPicker(null)}
          onPick={(c) => save({ 'System.IterationPath': c.key }, `Moved to ${c.label}`)}
        />
      )}
      {picker === 'area' && item && (
        <ListPicker
          title="Area"
          placeholder="Search area paths"
          load={areas}
          current={item.areaPath}
          onClose={() => setPicker(null)}
          onPick={(c) => save({ 'System.AreaPath': c.key }, 'Area saved')}
        />
      )}
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

function NumberField({ value, onSave }: { value?: number; onSave: (v: number | null) => void }): ReactNode {
  return (
    <input
      className="input"
      style={{ width: 90, padding: '3px 8px' }}
      type="number"
      min={0}
      step={0.5}
      defaultValue={value ?? ''}
      key={value ?? 'none'}
      onBlur={(e) => {
        const v = numberOrNull(e.target.value)
        if (v !== undefined && v !== (value ?? null)) onSave(v)
      }}
    />
  )
}
