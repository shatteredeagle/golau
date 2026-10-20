// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_COLS, columnOf, columnsFor, moveFields, statesFor } from '../src/shared/board.ts'
import type { BoardInfo, TypeInfo } from '../src/shared/types.ts'

const st = (name: string, category: string) => ({ name, color: '#888888', category }) as TypeInfo['states'][number]
const TYPES: TypeInfo[] = [
  { name: 'User Story', color: '#0', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Resolved', 'Resolved'), st('Closed', 'Completed')] },
  { name: 'Task', color: '#0', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Closed', 'Completed')] }
]
const BOARD: BoardInfo = {
  name: 'Stories',
  columnField: 'WEF_X_Kanban.Column',
  columns: [
    { name: 'New', columnType: 'incoming', stateMappings: { 'User Story': 'New' } },
    { name: 'Dev', columnType: 'inProgress', stateMappings: { 'User Story': 'Active' } },
    { name: 'Test', columnType: 'inProgress', stateMappings: { 'User Story': 'Active' } },
    { name: 'Review', columnType: 'inProgress', stateMappings: { 'User Story': 'Resolved' } },
    { name: 'Done', columnType: 'outgoing', stateMappings: { 'User Story': 'Closed' } }
  ]
}
const cols = columnsFor(BOARD, TYPES)
const story = (state: string, category: string, boardColumn?: string) => ({ type: 'User Story', state, category, boardColumn }) as never
const task = (state: string, category: string) => ({ type: 'Task', state, category }) as never

test('no board → state-category columns', () => {
  assert.equal(columnsFor(undefined, TYPES), CATEGORY_COLS)
  assert.equal(columnOf(CATEGORY_COLS, task('Active', 'InProgress')), 'doing')
  assert.deepEqual(statesFor(CATEGORY_COLS, TYPES, task('New', 'Proposed'), 'done'), ['Closed'])
})

test('board cards go where ADO put them, even when two columns share a state', () => {
  assert.deepEqual(cols.map((c) => c.label), ['New', 'Dev', 'Test', 'Review', 'Done'])
  assert.equal(columnOf(cols, story('Active', 'InProgress', 'Test')), 'ado:Test')
  assert.equal(columnOf(cols, story('Active', 'InProgress')), 'ado:Dev') // no column known → first for the state
  assert.equal(columnOf(cols, story('Removed', 'Removed')), undefined)
})

test('types not on the board go by state category', () => {
  assert.equal(columnOf(cols, task('New', 'Proposed')), 'ado:New')
  assert.equal(columnOf(cols, task('Active', 'InProgress')), 'ado:Dev')
  assert.equal(columnOf(cols, task('Closed', 'Completed')), 'ado:Done')
  // Review only holds Resolved; a Task has no such state
  assert.deepEqual(statesFor(cols, TYPES, task('Active', 'InProgress'), 'ado:Review'), [])
})

test('moving a board card sets the column field, and the state only when it changes', () => {
  const s = story('Active', 'InProgress', 'Dev')
  assert.deepEqual(statesFor(cols, TYPES, s, 'ado:Test'), ['Active'])
  assert.deepEqual(moveFields(BOARD, cols, s, 'ado:Test', 'Active'), { 'WEF_X_Kanban.Column': 'Test' })
  assert.deepEqual(moveFields(BOARD, cols, s, 'ado:Review', 'Resolved'), { 'System.State': 'Resolved', 'WEF_X_Kanban.Column': 'Review' })
  // tasks aren't on this board: state only
  assert.deepEqual(moveFields(BOARD, cols, task('New', 'Proposed'), 'ado:Dev', 'Active'), { 'System.State': 'Active' })
})
