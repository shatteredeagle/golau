/**
 * Descriptions are HTML in Azure DevOps. Golau edits the simple kind as Markdown-style text and writes it back as the same
 * simple HTML. Anything it can't write back unchanged (tables, images, mentions, inline styles, nested blocks...) is refused,
 * so an edit can never silently drop content.
 *
 *   text ↔ **bold**  *italic*  - bullet / 1. numbered lines  [label](https://link)  blank line = empty line
 */
export type Inline = { k: 'text'; v: string } | { k: 'b' | 'i'; c: Inline[] } | { k: 'a'; href: string; c: Inline[] }
export type Block = { t: 'line'; c: Inline[] } | { t: 'blank' } | { t: 'list'; ordered: boolean; items: Inline[][] }

const SAFE_HREF = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

// ---------- HTML → model ----------

interface Tok {
  tag?: string
  close?: boolean
  attrs?: string
  text?: string
}

function tokenize(html: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)\/?>/.exec(html.slice(i))
      if (!m) return null // comment, doctype, stray "<"
      out.push({ tag: m[2].toLowerCase(), close: m[1] === '/', attrs: m[3].trim() })
      i += m[0].length
    } else {
      const j = html.indexOf('<', i)
      const raw = html.slice(i, j < 0 ? undefined : j)
      i += raw.length
      let bad = false
      if (/&(?![#a-zA-Z0-9]+;)/.test(raw)) return null // a bare "&" is not valid HTML text
      const text = raw.replace(/&([#a-zA-Z0-9]+);/g, (_, e: string) => ENTITIES[e] ?? ((bad = true), ''))
      if (bad) return null
      out.push({ text })
    }
  }
  return out
}

const BLOCK = new Set(['div', 'p', 'ul', 'ol'])

function parseHtml(html: string): Block[] | null {
  const toks = tokenize(html)
  if (!toks) return null
  let pos = 0
  const blocks: Block[] = []
  const peek = (): Tok | undefined => toks[pos]

  /** inline content up to (not including) a closing tag in `until`, or a block tag / end. Lines split at <br>. */
  const inlineRun = (until: string | null, allowBr: boolean): Inline[][] | null => {
    const lines: Inline[][] = [[]]
    const stack: { tag: string; node: Inline[]; href?: string }[] = []
    const cur = (): Inline[] => (stack.length ? stack[stack.length - 1].node : lines[lines.length - 1])
    for (; pos < toks.length; pos++) {
      const t = toks[pos]
      if (t.text !== undefined) {
        const v = t.text.replace(/\s+/g, ' ')
        if (v) cur().push({ k: 'text', v })
        continue
      }
      const tag = t.tag!
      if (t.close) {
        if (stack.length && ['b', 'strong', 'i', 'em', 'a'].includes(tag)) {
          const top = stack.pop()!
          if (top.tag !== tag) return null
          const kind = tag === 'a' ? 'a' : tag === 'b' || tag === 'strong' ? 'b' : 'i'
          const node: Inline = kind === 'a' ? { k: 'a', href: top.href!, c: top.node } : { k: kind, c: top.node }
          cur().push(node)
          continue
        }
        if (stack.length) return null
        if (tag === until || BLOCK.has(tag) || tag === 'li') return lines
        return null
      }
      if (tag === 'br') {
        if (t.attrs || stack.length || !allowBr) return null
        lines.push([])
      } else if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em') {
        if (t.attrs) return null
        stack.push({ tag, node: [] })
      } else if (tag === 'a') {
        const m = /^href\s*=\s*(?:"([^"]*)"|'([^']*)')$/i.exec(t.attrs ?? '')
        const href = m && (m[1] ?? m[2])
        if (!href || !SAFE_HREF.test(href.replace(/&amp;/g, '&'))) return null
        stack.push({ tag, node: [], href: href.replace(/&amp;/g, '&') })
      } else if (BLOCK.has(tag) || tag === 'li') {
        if (until === null && lines.every((l) => !l.length)) return lines // block starts: run ends here
        if (until === null) return lines
        return null // block inside a block
      } else return null
    }
    return stack.length ? null : lines
  }

  while (pos < toks.length) {
    const t = peek()!
    if (t.text !== undefined || t.tag === 'br' || ['b', 'strong', 'i', 'em', 'a'].includes(t.tag ?? '')) {
      if (t.text !== undefined && !t.text.trim()) {
        pos++
        continue
      }
      const lines = inlineRun(null, true)
      if (!lines) return null
      for (const l of lines) blocks.push(l.length ? { t: 'line', c: trim(l) } : { t: 'blank' })
      continue
    }
    if (t.close) return null
    if (t.attrs) return null
    if (t.tag === 'div' || t.tag === 'p') {
      pos++
      const lines = inlineRun(t.tag, true)
      const end = peek()
      if (!lines || !end || !end.close || end.tag !== t.tag) return null
      pos++
      const nonEmpty = lines.filter((l, i) => l.length || i < lines.length - 1 || lines.length === 1)
      // <div><br></div> = one empty line; <div>a<br>b</div> = two lines; a trailing <br> adds nothing
      const parts = lines.length > 1 && !lines[lines.length - 1].length ? lines.slice(0, -1) : nonEmpty
      for (const l of parts.length ? parts : [[]]) blocks.push(l.length ? { t: 'line', c: trim(l) } : { t: 'blank' })
      continue
    }
    if (t.tag === 'ul' || t.tag === 'ol') {
      const ordered = t.tag === 'ol'
      pos++
      const items: Inline[][] = []
      for (;;) {
        const n = peek()
        if (!n) return null
        if (n.text !== undefined && !n.text.trim()) {
          pos++
          continue
        }
        if (n.close && n.tag === t.tag) {
          pos++
          break
        }
        if (n.tag === 'li' && !n.close && !n.attrs) {
          pos++
          const lines = inlineRun('li', false)
          const end = peek()
          if (!lines || lines.length !== 1 || !end || !end.close || end.tag !== 'li') return null
          pos++
          items.push(trim(lines[0]))
          continue
        }
        return null
      }
      if (!items.length) return null
      blocks.push({ t: 'list', ordered, items })
      continue
    }
    return null
  }
  return normalize(blocks)
}

// ---------- text ↔ model ----------

const esc = (s: string): string => s.replace(/[\\*[\]]/g, (c) => `\\${c}`)

function inlineToText(c: Inline[]): string {
  return c
    .map((n) => {
      if (n.k === 'text') return esc(n.v)
      if (n.k === 'a') return `[${inlineToText(n.c)}](${n.href})`
      return n.k === 'b' ? `**${inlineToText(n.c)}**` : `*${inlineToText(n.c)}*`
    })
    .join('')
}

function blocksToText(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.t === 'blank') out.push('')
    else if (b.t === 'line') {
      let s = inlineToText(b.c)
      if (/^(-\s|\d+\.\s)/.test(s)) s = `\\${s}` // a literal "- " or "1. " at the start is not a list
      out.push(s)
    } else b.items.forEach((it, i) => out.push(`${b.ordered ? `${i + 1}. ` : '- '}${inlineToText(it)}`))
  }
  return out.join('\n')
}

/** Parse inline markup in one line. */
function parseInlineText(s: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) out.push({ k: 'text', v: buf })
    buf = ''
  }
  const findClose = (from: number, mark: string): number => {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') j++
      else if (s.startsWith(mark, j)) return j
    }
    return -1
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) {
      buf += s[++i]
    } else if (ch === '*') {
      const mark = s.startsWith('**', i) ? '**' : '*'
      const end = findClose(i + mark.length, mark)
      const inner = end > 0 ? s.slice(i + mark.length, end) : ''
      if (end > 0 && inner && !/^\s|\s$/.test(inner)) {
        flush()
        out.push({ k: mark === '**' ? 'b' : 'i', c: parseInlineText(inner) })
        i = end + mark.length - 1
      } else buf += ch
    } else if (ch === '[') {
      const close = findClose(i + 1, ']')
      const m = close > 0 ? /^\(([^()\s]+)\)/.exec(s.slice(close + 1)) : null
      if (close > 0 && m && SAFE_HREF.test(m[1]) && close > i + 1) {
        flush()
        out.push({ k: 'a', href: m[1], c: parseInlineText(s.slice(i + 1, close)) })
        i = close + m[0].length
      } else buf += ch
    } else buf += ch
  }
  flush()
  return out
}

function parseText(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const ul = /^-\s+(.*)$/.exec(line)
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (ul || ol) {
      const ordered = !!ol
      const item = parseInlineText((ul ?? ol)![1].trim())
      if (last && last.t === 'list' && last.ordered === ordered) last.items.push(item)
      else blocks.push({ t: 'list', ordered, items: [item] })
    } else if (!line.trim()) blocks.push({ t: 'blank' })
    else blocks.push({ t: 'line', c: parseInlineText(line.trim()) })
  }
  return normalize(blocks)
}

// ---------- model helpers ----------

function trim(c: Inline[]): Inline[] {
  const r = merge(c)
  if (r.length && r[0].k === 'text') r[0] = { k: 'text', v: r[0].v.replace(/^\s+/, '') }
  const l = r.length - 1
  if (l >= 0 && r[l].k === 'text') r[l] = { k: 'text', v: (r[l] as { v: string }).v.replace(/\s+$/, '') }
  return r.filter((n) => n.k !== 'text' || n.v)
}

function merge(c: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const n of c) {
    const m: Inline = n.k === 'text' ? n : n.k === 'a' ? { ...n, c: merge(n.c) } : { ...n, c: merge(n.c) }
    const prev = out[out.length - 1]
    if (m.k === 'text' && prev && prev.k === 'text') out[out.length - 1] = { k: 'text', v: prev.v + m.v }
    else if (!(m.k === 'text' && !m.v)) out.push(m)
  }
  return out
}

function normalize(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.t === 'line' ? { t: 'line', c: merge(b.c) } : b.t === 'list' ? { ...b, items: b.items.map(merge) } : b
  )
}

// ---------- model → HTML ----------

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string): string => escHtml(s).replace(/"/g, '&quot;')

function inlineToHtml(c: Inline[]): string {
  return c
    .map((n) => {
      if (n.k === 'text') return escHtml(n.v)
      if (n.k === 'a') return `<a href="${escAttr(n.href)}">${inlineToHtml(n.c)}</a>`
      return n.k === 'b' ? `<b>${inlineToHtml(n.c)}</b>` : `<i>${inlineToHtml(n.c)}</i>`
    })
    .join('')
}

function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) =>
      b.t === 'blank'
        ? '<div><br></div>'
        : b.t === 'line'
          ? `<div>${inlineToHtml(b.c)}</div>`
          : `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
    )
    .join('')
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ---------- public ----------

/** Text typed in Golau → the HTML stored in Azure DevOps (empty text → empty string). */
export function textToHtml(text: string): string {
  const blocks = parseText(text)
  while (blocks.length && blocks[blocks.length - 1].t === 'blank') blocks.pop()
  return blocksToHtml(blocks)
}

/**
 * The text to edit for stored HTML, or null when the HTML has anything Golau can't write back unchanged.
 * Safe by construction: the text must parse back to exactly the same content.
 */
export function htmlToEditable(html: string | undefined): string | null {
  if (!html || !html.trim()) return ''
  const model = parseHtml(html)
  if (!model) return null
  const text = blocksToText(model)
  const back = parseText(text)
  const a = model.filter((b, i) => !(b.t === 'blank' && i === model.length - 1))
  const b = back.filter((x, i) => !(x.t === 'blank' && i === back.length - 1))
  return same(a, b) ? text : null
}
