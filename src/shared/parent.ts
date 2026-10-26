import type { SearchQuery } from './types'

/** Backlog level of each work item type: 0 task, 1 requirement (Story/PBI/Issue), 2 feature, 3 epic. */
export type TypeLevels = Record<string, number>

export const PARENT_REL = 'System.LinkTypes.Hierarchy-Reverse'

const CATEGORY_LEVEL: Record<string, number> = {
  'Microsoft.TaskCategory': 0,
  'Microsoft.RequirementCategory': 1,
  'Microsoft.FeatureCategory': 2,
  'Microsoft.EpicCategory': 3
}

/** Type → level, from ADO's work item type categories (works in every process, custom types included). */
export function levelsFromCategories(cats: { referenceName: string; workItemTypes?: { name: string }[] }[]): TypeLevels {
  const out: TypeLevels = {}
  for (const c of cats) {
    const level = CATEGORY_LEVEL[c.referenceName]
    if (level !== undefined) for (const t of c.workItemTypes ?? []) out[t.name] = level
  }
  return out
}

export interface ParentChip {
  type: string
  /** one level above the child: what Azure DevOps accepts. Other chips are dimmed, still tappable. */
  expected: boolean
}

/** Type filter chips for a parent search, lowest level first (PBI, Feature, Epic). Empty when the type's level is unknown. */
export function parentChips(childType: string, levels: TypeLevels): ParentChip[] {
  const child = levels[childType]
  if (child === undefined) return []
  return Object.entries(levels)
    .filter(([, l]) => l >= Math.max(1, child))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([type, l]) => ({ type, expected: l === child + 1 }))
}

/** Chips ticked when the picker opens: the expected level, or everything when nothing is expected (e.g. an Epic). */
export function defaultParentTypes(chips: ParentChip[]): string[] {
  const expected = chips.filter((c) => c.expected)
  return (expected.length ? expected : chips).map((c) => c.type)
}

export function parentSearch(text: string, types: string[], projectOnly: boolean): SearchQuery {
  return { text, types: types.length ? types : undefined, allProjects: !projectOnly, status: 'active', assigned: 'anyone' }
}

/** Candidates that make no sense as the new parent: the card itself and the parent it already has. */
export const isParentCandidate = (cand: { id: number }, itemId?: number, currentParentId?: number): boolean =>
  cand.id !== itemId && cand.id !== currentParentId

export interface Relation {
  rel: string
  url: string
}

export const parentLink = (org: string, parentId: number): Relation => ({
  rel: PARENT_REL,
  url: `${org}/_apis/wit/workItems/${parentId}`
})

export function parentIdOf(relations: Relation[] | undefined): number | undefined {
  const r = relations?.find((x) => x.rel === PARENT_REL)
  const m = r && /\/workItems\/(\d+)$/i.exec(r.url)
  return m ? Number(m[1]) : undefined
}

/**
 * JSON Patch that makes `next` the parent (null removes it). Replacing is one request, so a refused link leaves the
 * old parent in place; `test /rev` stops it if the card changed after we read its relations (the index would be stale).
 * Empty when nothing changes.
 */
export function parentPatch(org: string, item: { id: number; rev: number; relations?: Relation[] }, next: number | null): unknown[] {
  if (next !== null && (!Number.isSafeInteger(next) || next <= 0)) throw new Error(`Bad parent id: ${String(next)}`)
  if (next === item.id) throw new Error('A card cannot be its own parent')
  const at = (item.relations ?? []).findIndex((r) => r.rel === PARENT_REL)
  if (at >= 0 && parentIdOf(item.relations) === next) return []
  if (at < 0 && next === null) return []
  const ops: unknown[] = []
  if (at >= 0) ops.push({ op: 'test', path: '/rev', value: item.rev }, { op: 'remove', path: `/relations/${at}` })
  if (next !== null) ops.push({ op: 'add', path: '/relations/-', value: parentLink(org, next) })
  return ops
}
