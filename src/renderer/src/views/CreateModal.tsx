import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import type { FieldSpec, Route } from '@shared/types'
import { call } from '../api'
import { Modal, ModalHead, TypeChip, useApp, useAutoFocus } from '../components'
import { coerceField, FieldInput, FieldRow, isBlank, requiredExtraFields, timeEstimateSpec, type FieldValue } from '../fields'
import { PickModal } from './PickModal'

const PREFERRED = ['Task', 'Bug', 'User Story', 'Product Backlog Item', 'Issue', 'Feature', 'Epic']
const DESCRIPTION = 'System.Description'

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

  // What this type's process requires, plus anything Azure DevOps rejected on a previous try.
  const [specs, setSpecs] = useState<FieldSpec[] | null>(null)
  const [extraValues, setExtraValues] = useState<Record<string, FieldValue>>({})
  const [rejected, setRejected] = useState<FieldSpec[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    setSpecs(null)
    setRejected([])
    setFieldErrors({})
    call('typeFields', type)
      .then((s) => live && setSpecs(s))
      .catch(() => live && setSpecs([]))
    return () => {
      live = false
    }
  }, [type])

  const descriptionRequired = !!specs?.find((s) => s.referenceName === DESCRIPTION)?.alwaysRequired
  const extras = [...requiredExtraFields(specs ?? []), ...rejected].filter(
    (s, i, all) => all.findIndex((x) => x.referenceName === s.referenceName) === i
  )

  // optional "Time Estimate" input; when the process requires it, it's already among the extras
  const estimate = timeEstimateSpec(specs ?? [])
  const optionalEstimate = estimate && !extras.some((x) => x.referenceName === estimate.referenceName) ? estimate : undefined

  const fromUnplanned = route.fromUnplanned ? state.unplanned.find((u) => u.id === route.fromUnplanned) : undefined
  const isTask = /task/i.test(type)

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    // check what we already know is required before bothering Azure DevOps
    const missing: Record<string, string> = {}
    if (descriptionRequired && !description.trim()) missing[DESCRIPTION] = 'Required for this type'
    for (const s of extras) if (isBlank(extraValues[s.referenceName])) missing[s.referenceName] = 'Required'
    setFieldErrors(missing)
    if (Object.keys(missing).length) {
      setError('')
      return
    }

    setBusy(true)
    setError('')
    try {
      const fields: Record<string, unknown> = {}
      for (const s of extras) {
        const v = extraValues[s.referenceName]
        if (!isBlank(v)) fields[s.referenceName] = coerceField(s, v!)
      }
      const est = optionalEstimate && extraValues[optionalEstimate.referenceName]
      if (optionalEstimate && est !== undefined && !isBlank(est)) fields[optionalEstimate.referenceName] = coerceField(optionalEstimate, est)
      const r = await call('createItem', {
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        parentId,
        assignToMe,
        currentIteration,
        tags: tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        remainingWork: isTask && remaining ? Number(remaining) : undefined,
        startFocus,
        fields,
        fromUnplanned: route.fromUnplanned,
        fromInbox: route.fromInbox
      })
      if (r.ok) {
        toast(`Created #${r.value.id}`, { action: { label: 'Open', run: () => openItem(r.value.id) } })
        onClose()
        return
      }
      // Azure DevOps has a rule we didn't know about (conditional or custom): show those fields too.
      const errs: Record<string, string> = {}
      const added: FieldSpec[] = []
      for (const fe of r.fieldErrors) {
        const ref = fe.referenceName ?? fe.name
        errs[ref] = fe.required ? 'Required' : fe.message
        if (fe.field && ref !== DESCRIPTION && !extras.some((x) => x.referenceName === ref)) added.push(fe.field)
      }
      setRejected((x) => [...x, ...added])
      setFieldErrors(errs)
      setError(r.fieldErrors.length ? `${r.message}. Fill in the highlighted field${r.fieldErrors.length > 1 ? 's' : ''} and create again.` : r.message)
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
          <span>
            Title <span className="req">*</span>
          </span>
          <input ref={titleRef} className="input" style={{ fontSize: 15 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short and specific" />
        </label>
        <label className="field">
          <span>
            Description{' '}
            {descriptionRequired ? <span className="req" title="Required by your Azure DevOps process">*</span> : <span className="faint">(optional)</span>}
          </span>
          <textarea
            className={`textarea${fieldErrors[DESCRIPTION] ? ' invalid' : ''}`}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldErrors[DESCRIPTION] && <span className="field-error">{fieldErrors[DESCRIPTION]}</span>}
        </label>

        {specs === null && (
          <div className="faint small">
            <Loader2 size={12} className="spin" /> Checking what {type} needs…
          </div>
        )}
        {extras.map((s) => (
          <FieldRow
            key={s.referenceName}
            spec={s}
            value={extraValues[s.referenceName]}
            onChange={(v) => setExtraValues((x) => ({ ...x, [s.referenceName]: v }))}
            error={fieldErrors[s.referenceName]}
          />
        ))}

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
          {optionalEstimate && (
            <label className="field" style={{ width: optionalEstimate.allowedValues?.length ? 160 : 130 }}>
              {optionalEstimate.name}
              <FieldInput
                spec={optionalEstimate}
                value={extraValues[optionalEstimate.referenceName]}
                onChange={(v) => setExtraValues((x) => ({ ...x, [optionalEstimate.referenceName]: v }))}
              />
            </label>
          )}
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
          <span className="faint small">
            <span className="req">*</span> required · Ctrl+Enter to create
          </span>
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
          parentFor={{ type }}
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
