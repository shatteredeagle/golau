import { useEffect, useState, type ReactNode } from 'react'
import type { FieldSpec } from '@shared/types'
import { isTimeEstimate } from '@shared/fields'

/** Fields the create form already has its own inputs or checkboxes for. */
export const HANDLED_ON_CREATE = new Set([
  'System.Title',
  'System.Description',
  'System.AssignedTo',
  'System.IterationPath',
  'System.Tags',
  'Microsoft.VSTS.Scheduling.RemainingWork'
])

/** Fields ADO sets itself; never ask the user for them. */
const SYSTEM_MANAGED = /^System\.(Id|Rev|State|Reason|WorkItemType|TeamProject|CreatedBy|CreatedDate|ChangedBy|ChangedDate|AuthorizedAs|AuthorizedDate|RevisedDate|Watermark|BoardColumn|BoardColumnDone|BoardLane|CommentCount|NodeName|AreaId|IterationId|Parent|History)$/

/** Required fields the user has to fill in when creating an item of this type. */
export function requiredExtraFields(specs: FieldSpec[]): FieldSpec[] {
  return specs.filter(
    (s) =>
      s.alwaysRequired &&
      !s.readOnly &&
      (s.defaultValue === undefined || s.defaultValue === null || s.defaultValue === '') &&
      !HANDLED_ON_CREATE.has(s.referenceName) &&
      !SYSTEM_MANAGED.test(s.referenceName)
  )
}

/** The process's "Time Estimate" field for this type, if it has one the user can edit. */
export const timeEstimateSpec = (specs: FieldSpec[]): FieldSpec | undefined =>
  specs.find((s) => isTimeEstimate(s.name) && !s.readOnly)

export type FieldValue = string | boolean

export const isBlank = (v: FieldValue | undefined): boolean => v === undefined || v === '' || v === false

/** Convert what an input holds into what Azure DevOps expects for the field. */
export function coerceField(spec: FieldSpec | undefined, v: FieldValue): unknown {
  if (typeof v === 'boolean') return v
  if (spec?.kind === 'integer') return parseInt(v, 10)
  if (spec?.kind === 'double') return Number(v)
  if (spec?.kind === 'dateTime') return new Date(v).toISOString()
  return v
}

/** What an input should hold for a value that came from Azure DevOps. */
export function toFieldValue(spec: FieldSpec, v: unknown): FieldValue {
  if (v === undefined || v === null) return spec.kind === 'boolean' ? false : ''
  if (typeof v === 'boolean') return v
  if (spec.kind === 'dateTime') return String(v).slice(0, 10)
  return String(v)
}

/** Inline editor for an existing item's field: picklists and checkboxes save on change, the rest on blur. */
export function FieldEditor({ spec, value, onSave }: { spec: FieldSpec; value: unknown; onSave: (v: unknown) => void }): ReactNode {
  const initial = toFieldValue(spec, value)
  const [v, setV] = useState<FieldValue>(initial)
  useEffect(() => setV(initial), [initial])
  const immediate = !!spec.allowedValues?.length || spec.kind === 'boolean'
  const commit = (next: FieldValue): void => {
    if (next === initial) return
    // an emptied input clears the field
    onSave(typeof next === 'boolean' ? next : next === '' ? null : coerceField(spec, next))
  }
  return (
    <span className="field-edit" onBlur={() => !immediate && commit(v)}>
      <FieldInput
        spec={spec}
        value={v}
        onChange={(next) => {
          setV(next)
          if (immediate) commit(next)
        }}
      />
    </span>
  )
}

/** One input for any work item field, chosen by its type and allowed values. */
export function FieldInput({
  spec,
  value,
  onChange,
  invalid,
  autoFocus
}: {
  spec: FieldSpec
  value: FieldValue | undefined
  onChange: (v: FieldValue) => void
  invalid?: boolean
  autoFocus?: boolean
}): ReactNode {
  const cls = invalid ? ' invalid' : ''
  if (spec.allowedValues?.length)
    return (
      <select className={`select${cls}`} value={String(value ?? '')} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {spec.allowedValues.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    )
  switch (spec.kind) {
    case 'boolean':
      return <input type="checkbox" checked={value === true} autoFocus={autoFocus} onChange={(e) => onChange(e.target.checked)} />
    case 'integer':
    case 'double':
      return (
        <input
          className={`input${cls}`}
          style={{ width: 140 }}
          type="number"
          step={spec.kind === 'integer' ? 1 : 'any'}
          value={String(value ?? '')}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'dateTime':
      return <input className={`input${cls}`} style={{ width: 180 }} type="date" value={String(value ?? '')} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    case 'html':
    case 'plainText':
      return <textarea className={`textarea${cls}`} rows={3} value={String(value ?? '')} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    default:
      return (
        <input
          className={`input${cls}`}
          value={String(value ?? '')}
          autoFocus={autoFocus}
          placeholder={spec.kind === 'identity' ? 'name@company.com' : spec.kind === 'treePath' ? 'Project\\Area' : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** Label + input + help/error text for one field. */
export function FieldRow({
  spec,
  value,
  onChange,
  error,
  autoFocus
}: {
  spec: FieldSpec
  value: FieldValue | undefined
  onChange: (v: FieldValue) => void
  error?: string
  autoFocus?: boolean
}): ReactNode {
  return (
    <label className="field">
      <span>
        {spec.name} <span className="req" title="Required by your Azure DevOps process">*</span>
      </span>
      {spec.helpText && <span className="faint">{spec.helpText}</span>}
      <FieldInput spec={spec} value={value} onChange={onChange} invalid={!!error} autoFocus={autoFocus} />
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}
