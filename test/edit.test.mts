import test from 'node:test'
import assert from 'node:assert/strict'
import { addTags, filterPeople, flattenTree, joinTags, mergePeople, numberOrNull, parseTags, sortIterations, workItemPath } from '../src/shared/edit.ts'

test('tags parse and join the way ADO stores them', () => {
  assert.deepEqual(parseTags('auth; partner;  ; reporting'), ['auth', 'partner', 'reporting'])
  assert.deepEqual(parseTags(undefined), [])
  assert.equal(joinTags(['auth', 'Auth', ' partner ', '']), 'auth; partner')
})

test('typing tags: commas and semicolons split, duplicates ignored', () => {
  assert.deepEqual(addTags(['auth'], 'api, Auth; web'), ['auth', 'api', 'web'])
  assert.deepEqual(addTags([], '  '), [])
})

test('classification node paths become work item paths', () => {
  assert.equal(workItemPath('\\Proj\\Iteration\\Release 1\\Sprint 1'), 'Proj\\Release 1\\Sprint 1')
  assert.equal(workItemPath('\\Proj\\Area\\Core\\API'), 'Proj\\Core\\API')
  assert.equal(workItemPath('\\Proj\\Iteration'), 'Proj')
  assert.equal(workItemPath('Proj\\Sprint 2'), 'Proj\\Sprint 2')
})

test('a tree flattens to pickable paths, root included', () => {
  const tree = { name: 'P', path: '\\P\\Iteration', children: [{ name: 'S1', path: '\\P\\Iteration\\S1', attributes: { startDate: '2026-01-05' }, children: [{ name: 'W1', path: '\\P\\Iteration\\S1\\W1' }] }] }
  assert.deepEqual(flattenTree(tree).map((i) => i.path), ['P', 'P\\S1', 'P\\S1\\W1'])
  assert.equal(flattenTree(tree, 2).length, 2)
  assert.deepEqual(flattenTree(undefined), [])
})

test('sprints: current, then upcoming soonest first, then past newest first', () => {
  const list = [
    { name: 'a', path: 'P\\a', timeFrame: 'past', start: '2026-01-01' },
    { name: 'b', path: 'P\\b', timeFrame: 'future', start: '2026-03-01' },
    { name: 'c', path: 'P\\c', timeFrame: 'current', start: '2026-02-01' },
    { name: 'd', path: 'P\\d', timeFrame: 'past', start: '2025-12-01' },
    { name: 'e', path: 'P\\e', timeFrame: 'future', start: '2026-02-15' },
    { name: 'f', path: 'P\\f' }
  ]
  assert.deepEqual(sortIterations(list).map((i) => i.name), ['c', 'e', 'b', 'a', 'd', 'f'])
})

test('people: every typed word must match the name or email; order kept', () => {
  const ppl = [{ name: 'Priya Patel', email: 'priya@x.com' }, { name: 'Sam Rivera', email: 'sam@x.com' }]
  assert.deepEqual(filterPeople(ppl, 'pat pri').map((p) => p.name), ['Priya Patel'])
  assert.deepEqual(filterPeople(ppl, 'x.com').length, 2)
  assert.deepEqual(filterPeople(ppl, ''), ppl)
})

test('merging people drops repeats by email, falling back to name', () => {
  const m = mergePeople([{ name: 'Priya Patel', email: 'Priya@x.com' }], [{ name: 'Priya P.', email: 'priya@x.com' }, { name: 'Sam' }], [{ name: 'sam' }])
  assert.deepEqual(m.map((p) => p.name), ['Priya Patel', 'Sam'])
})

test('number box: blank clears, junk is refused', () => {
  assert.equal(numberOrNull(''), null)
  assert.equal(numberOrNull(' 2.5 '), 2.5)
  assert.equal(numberOrNull('0'), 0)
  assert.equal(numberOrNull('abc'), undefined)
  assert.equal(numberOrNull('-1'), undefined)
})
