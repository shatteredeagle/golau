import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultParentTypes,
  isParentCandidate,
  levelsFromCategories,
  parentChips,
  parentIdOf,
  parentPatch,
  parentSearch,
  PARENT_REL
} from '../src/shared/parent.ts'

const ORG = 'https://dev.azure.com/o'
const link = (id: number) => ({ rel: PARENT_REL, url: `${ORG}/_apis/wit/workItems/${id}` })
const other = { rel: 'AttachedFile', url: 'https://x/a.png' }

const levels = levelsFromCategories([
  { referenceName: 'Microsoft.EpicCategory', workItemTypes: [{ name: 'Epic' }] },
  { referenceName: 'Microsoft.FeatureCategory', workItemTypes: [{ name: 'Feature' }] },
  { referenceName: 'Microsoft.RequirementCategory', workItemTypes: [{ name: 'Product Backlog Item' }, { name: 'Bug' }] },
  { referenceName: 'Microsoft.TaskCategory', workItemTypes: [{ name: 'Task' }] },
  { referenceName: 'Microsoft.TestPlanCategory', workItemTypes: [{ name: 'Test Plan' }] }
])

test('type levels come from the categories; unknown categories are ignored', () => {
  assert.deepEqual(levels, { Epic: 3, Feature: 2, 'Product Backlog Item': 1, Bug: 1, Task: 0 })
})

test('a PBI gets PBI/Bug/Feature/Epic chips with only Feature expected', () => {
  const chips = parentChips('Product Backlog Item', levels)
  assert.deepEqual(chips.map((c) => c.type), ['Bug', 'Product Backlog Item', 'Feature', 'Epic'])
  assert.deepEqual(chips.filter((c) => c.expected).map((c) => c.type), ['Feature'])
  assert.deepEqual(defaultParentTypes(chips), ['Feature'])
})

test('a Feature expects Epic; an Epic has nothing expected so every chip is ticked', () => {
  assert.deepEqual(defaultParentTypes(parentChips('Feature', levels)), ['Epic'])
  assert.deepEqual(defaultParentTypes(parentChips('Epic', levels)), ['Epic'])
})

test('a Task expects the requirement level', () => {
  assert.deepEqual(defaultParentTypes(parentChips('Task', levels)), ['Bug', 'Product Backlog Item'])
})

test('unknown child type → no chips, no filter', () => {
  assert.deepEqual(parentChips('Mystery', levels), [])
  assert.equal(parentSearch('x', [], true).types, undefined)
})

test('project toggle maps to allProjects; text and types pass through', () => {
  assert.deepEqual(parentSearch('sso', ['Feature'], true), { text: 'sso', types: ['Feature'], allProjects: false, status: 'active', assigned: 'anyone' })
  assert.equal(parentSearch('sso', ['Feature'], false).allProjects, true)
})

test('the card itself and its current parent are not candidates', () => {
  assert.equal(isParentCandidate({ id: 5 }, 5, 9), false)
  assert.equal(isParentCandidate({ id: 9 }, 5, 9), false)
  assert.equal(isParentCandidate({ id: 7 }, 5, 9), true)
  assert.equal(isParentCandidate({ id: 5 }), true)
})

test('parentIdOf reads the id from the relation url', () => {
  assert.equal(parentIdOf([other, link(42)]), 42)
  assert.equal(parentIdOf([other]), undefined)
  assert.equal(parentIdOf(undefined), undefined)
})

test('adding a parent to a card with none is a single add', () => {
  assert.deepEqual(parentPatch(ORG, { id: 1, rev: 3, relations: [other] }, 9), [
    { op: 'add', path: '/relations/-', value: link(9) }
  ])
})

test('replacing tests the rev, removes the old link by its index and adds the new one', () => {
  assert.deepEqual(parentPatch(ORG, { id: 1, rev: 3, relations: [other, link(5)] }, 9), [
    { op: 'test', path: '/rev', value: 3 },
    { op: 'remove', path: '/relations/1' },
    { op: 'add', path: '/relations/-', value: link(9) }
  ])
})

test('clearing removes only; clearing nothing and re-picking the same parent change nothing', () => {
  assert.deepEqual(parentPatch(ORG, { id: 1, rev: 3, relations: [link(5)] }, null), [
    { op: 'test', path: '/rev', value: 3 },
    { op: 'remove', path: '/relations/0' }
  ])
  assert.deepEqual(parentPatch(ORG, { id: 1, rev: 3, relations: [other] }, null), [])
  assert.deepEqual(parentPatch(ORG, { id: 1, rev: 3, relations: [link(5)] }, 5), [])
})

test('self-parent and bad ids are refused', () => {
  assert.throws(() => parentPatch(ORG, { id: 1, rev: 1 }, 1), /own parent/)
  for (const bad of [0, -3, 1.5, NaN]) assert.throws(() => parentPatch(ORG, { id: 1, rev: 1 }, bad), /Bad parent id/)
})
