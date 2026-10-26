import type { Person } from './types'

/** System.Tags is one string, "a; b". */
export const parseTags = (s: string | undefined): string[] =>
  (s ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)

/** Join without duplicates (case-insensitive: ADO treats "API" and "api" as one tag). */
export function joinTags(tags: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.join('; ')
}

/** A new tag typed in the box ("a, b; c" adds three). */
export const addTags = (current: string[], typed: string): string[] => parseTags(joinTags([...current, ...typed.split(/[,;]/)]))

export interface IterationInfo {
  name: string
  path: string
  /** 'current' | 'future' | 'past' (team iterations); absent for the project tree */
  timeFrame?: string
  start?: string
}

/** Current sprint first, then the coming ones soonest first, then past ones newest first; undated last. */
export function sortIterations(list: IterationInfo[]): IterationInfo[] {
  const rank = (i: IterationInfo): number => (i.timeFrame === 'current' ? 0 : i.timeFrame === 'future' ? 1 : i.timeFrame === 'past' ? 2 : 3)
  const t = (i: IterationInfo): number => (i.start ? Date.parse(i.start) || 0 : 0)
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? t(b) - t(a) : t(a) - t(b)) || a.path.localeCompare(b.path))
}

export interface ClassificationNode {
  name: string
  path: string
  structureType?: string
  attributes?: { startDate?: string; finishDate?: string }
  children?: ClassificationNode[]
}

/**
 * Classification-node paths look like `\Project\Iteration\Release 1\Sprint 1`; work items want `Project\Release 1\Sprint 1`
 * (no leading slash, no "Iteration"/"Area" segment).
 */
export function workItemPath(nodePath: string): string {
  const parts = nodePath.split('\\').filter(Boolean)
  if (parts.length >= 2 && /^(Iteration|Area)$/i.test(parts[1])) parts.splice(1, 1)
  return parts.join('\\')
}

/** Every node of the tree (root included) as a pickable path. */
export function flattenTree(root: ClassificationNode | undefined, limit = 1000): IterationInfo[] {
  const out: IterationInfo[] = []
  const walk = (n: ClassificationNode): void => {
    if (out.length >= limit) return
    out.push({ name: n.name, path: workItemPath(n.path), start: n.attributes?.startDate })
    for (const c of n.children ?? []) walk(c)
  }
  if (root) walk(root)
  return out
}

/** People matching what was typed (name or email, every word), keeping the given order. */
export function filterPeople(people: Person[], text: string): Person[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  return people.filter((p) => words.every((w) => `${p.name} ${p.email ?? ''}`.toLowerCase().includes(w)))
}

/** Same person if the email matches, else the name (identities from different calls can differ in what they carry). */
export const samePerson = (a: Person, b: Person): boolean =>
  a.email && b.email ? a.email.toLowerCase() === b.email.toLowerCase() : a.name.toLowerCase() === b.name.toLowerCase()

export function mergePeople(...lists: Person[][]): Person[] {
  const out: Person[] = []
  for (const p of lists.flat()) if (p.name && !out.some((x) => samePerson(x, p))) out.push(p)
  return out
}

/** A number box: blank clears the field (null), anything unreadable is refused (undefined). */
export function numberOrNull(s: string): number | null | undefined {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
