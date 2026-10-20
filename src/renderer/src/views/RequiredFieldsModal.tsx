import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { FieldError, WorkItem } from '@shared/types'
import { call } from '../api'
import { Modal, ModalHead } from '../components'
import { coerceField, FieldRow, isBlank, type FieldValue } from '../fields'

export interface Fixup {
  item: { id: number; title: string }
  fields: Record<string, unknown>
  errors: FieldError[]
  resolve: (w: WorkItem | null) => void
}

const describe = (fields: Record<string, unknown>): string => {
  const state = fields['System.State']
  return typeof state === 'string' ? `Moving to ${state}` : 'Saving this change'
}

/**
 * Azure DevOps refused a change because the process wants more fields (e.g. Effort before
 * Committed). Ask for exactly those, then retry the original change with them added.
 */
export function RequiredFieldsModal({ fixup, onDone }: { fixup: Fixup; onDone: () => void }): ReactNode {
  const [errors, setErrors] = useState(fixup.errors)
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const fixable = errors.filter((e) => e.field && e.referenceName)
  const other = errors.filter((e) => !e.field || !e.referenceName)

  const close = (w: WorkItem | null): void => {
    fixup.resolve(w)
    onDone()
  }

  const save = async (): Promise<void> => {
    if (fixable.some((e) => e.required && isBlank(values[e.referenceName!]))) {
      setMessage('Fill in the highlighted fields.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const extra: Record<string, unknown> = {}
      for (const e of fixable) {
        const v = values[e.referenceName!]
        if (!isBlank(v)) extra[e.referenceName!] = coerceField(e.field, v!)
      }
      const r = await call('updateItem', fixup.item.id, { ...fixup.fields, ...extra })
      if (r.ok) return close(r.value)
      setErrors(r.fieldErrors.length ? r.fieldErrors : errors)
      setMessage(r.message)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={() => close(null)}>
      <ModalHead
        title={`#${fixup.item.id} needs a bit more`}
        sub={`${describe(fixup.fields)} requires ${errors.map((e) => e.name).join(', ')} in your Azure DevOps process.`}
        onClose={() => close(null)}
      />
      <div className="faint small ellipsis">{fixup.item.title}</div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {fixable.map((e, i) => (
          <FieldRow
            key={e.referenceName}
            spec={e.field!}
            value={values[e.referenceName!]}
            onChange={(v) => setValues((x) => ({ ...x, [e.referenceName!]: v }))}
            error={message && isBlank(values[e.referenceName!]) ? (e.required ? 'Required' : e.message) : undefined}
            autoFocus={i === 0}
          />
        ))}
        {other.map((e) => (
          <div key={e.name} className="error">
            {e.message}
          </div>
        ))}
        {message && <div className="error">{message}</div>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || fixable.length === 0}>
            {busy && <Loader2 size={15} className="spin" />} Save and {typeof fixup.fields['System.State'] === 'string' ? `move to ${fixup.fields['System.State']}` : 'retry'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
