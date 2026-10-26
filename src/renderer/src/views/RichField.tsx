import { useState, type ReactNode } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { htmlToEditable, textToHtml } from '@shared/richtext'
import { Html, OpenInAdo } from '../components'

/**
 * Description / Acceptance criteria: shown as before, with an Edit button when the stored HTML is simple enough to write back
 * unchanged. Otherwise (tables, images, mentions, styles...) it stays read-only and points at Azure DevOps.
 */
export function RichField({
  label,
  html,
  itemId,
  onSave
}: {
  label: string
  html?: string
  itemId: number
  /** html: what to store (null clears the field). Resolves false if it wasn't saved. */
  onSave: (html: string | null) => Promise<boolean>
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const editable = htmlToEditable(html)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const out = textToHtml(text)
      if (await onSave(out || null)) setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <div className="section-title" style={{ margin: 0 }}>
          {label}
        </div>
        <span className="spacer" />
        {!editing &&
          (editable !== null ? (
            <button
              className="btn sm"
              onClick={() => {
                setText(editable)
                setEditing(true)
              }}
            >
              <Pencil size={12} /> Edit
            </button>
          ) : (
            <span className="row small faint" title="It has formatting (tables, images, mentions...) that Golau would lose. Edit it in Azure DevOps.">
              Has rich formatting <OpenInAdo id={itemId} label />
            </span>
          ))}
      </div>
      {editing ? (
        <>
          <textarea
            className="textarea"
            rows={8}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                e.nativeEvent.stopPropagation()
                setEditing(false)
              } else if (e.key === 'Enter' && e.ctrlKey) void save()
            }}
          />
          <div className="small faint">
            **bold** · *italic* · - bullet · 1. numbered · [text](https://link) · Ctrl+Enter to save · Esc to cancel
          </div>
          <div className="row">
            <button className="btn sm primary" disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 size={13} className="spin" />} Save
            </button>
            <button className="btn sm" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <Html html={html} />
      )}
    </div>
  )
}
