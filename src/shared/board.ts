import type { BoardColumn, BoardInfo, StateCategory, TypeInfo, WorkItem } from './types'

/** A board column: one from the team's ADO board, or a state-category column when there's no board. */
export interface Col {
  key: string
  label: string
  ado?: BoardColumn
  /** state categories that belong here (used for types that aren't on the ADO board, e.g. Tasks) */
  categories: StateCategory[]
}

/** Used without a team, or when the board can't be read. */
export const CATEGORY_COLS: Col[] = [
  { key: 'todo', label: 'To do', categories: ['Proposed'] },
  { key: 'doing', label: 'Doing', categories: ['InProgress'] },
  { key: 'review', label: 'Review / resolved', categories: ['Resolved'] },
  { key: 'done', label: 'Done this week', categories: ['Completed'] }
]

type Card = Pick<WorkItem, 'type' | 'state' | 'category' | 'boardColumn'>

const categoryOf = (types: TypeInfo[], type: string, state: string): StateCategory | undefined =>
  types.find((t) => t.name === type)?.states.find((s) => s.name === state)?.category

export function columnsFor(board: BoardInfo | undefined, types: TypeInfo[]): Col[] {
  if (!board?.columns.length) return CATEGORY_COLS
  return board.columns.map((c) => {
    const cats = new Set<StateCategory>()
    for (const [type, state] of Object.entries(c.stateMappings)) {
      const k = categoryOf(types, type, state)
      if (k) cats.add(k)
    }
    if (c.columnType === 'incoming') cats.add('Proposed')
    if (c.columnType === 'outgoing') cats.add('Completed')
    return { key: `ado:${c.name}`, label: c.name, ado: c, categories: [...cats] }
  })
}

/** Does the ADO board itself track this type (it has a state mapping for it)? */
export const onBoard = (cols: Col[], type: string): boolean => cols.some((c) => c.ado?.stateMappings[type] !== undefined)

/** Which column a card sits in (undefined: not shown, e.g. Removed). */
export function columnOf(cols: Col[], item: Card): string | undefined {
  if (item.category === 'Removed') return undefined
  if (onBoard(cols, item.type)) {
    // ADO's own placement first: two columns can share a state (e.g. Dev and Test both "Active")
    const placed = item.boardColumn ? cols.find((c) => c.ado?.name === item.boardColumn) : undefined
    if (placed && placed.ado!.stateMappings[item.type] !== undefined) return placed.key
    const byState = cols.find((c) => c.ado?.stateMappings[item.type] === item.state)
    if (byState) return byState.key
  }
  // everything else by state category: new ones in the first column that takes them, done ones in the last
  const fits = cols.filter((c) => c.categories.includes(item.category))
  if (!fits.length) return cols.find((c) => c.ado?.columnType === 'inProgress')?.key
  if (item.category === 'Completed') return fits[fits.length - 1].key
  return (fits.find((c) => !c.ado || c.ado.columnType === 'inProgress') ?? fits[0]).key
}

/** States a card can take to land in a column; empty when its type can't go there. */
export function statesFor(cols: Col[], types: TypeInfo[], item: Card, key: string): string[] {
  const col = cols.find((c) => c.key === key)
  if (!col) return []
  if (col.ado && onBoard(cols, item.type)) {
    const s = col.ado.stateMappings[item.type]
    return s ? [s] : []
  }
  return (
    types
      .find((t) => t.name === item.type)
      ?.states.filter((s) => col.categories.includes(s.category) && s.name !== item.state)
      .map((s) => s.name) ?? []
  )
}

/** The field changes for moving a card into a column with the given state. */
export function moveFields(board: BoardInfo | undefined, cols: Col[], item: Card, key: string, state: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (state !== item.state) fields['System.State'] = state
  const col = cols.find((c) => c.key === key)
  if (col?.ado && board?.columnField && onBoard(cols, item.type)) fields[board.columnField] = col.ado.name
  return fields
}
