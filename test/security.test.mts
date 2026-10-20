// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AdoClient, assertId, checkOrgUrl } from '../src/main/ado.ts'
import { Tracker } from '../src/main/tracker.ts'
import type { AppState } from '../src/shared/types.ts'

test('org URL: only Azure DevOps hosts get the token', () => {
  assert.equal(checkOrgUrl('https://dev.azure.com/contoso'), 'https://dev.azure.com/contoso')
  assert.equal(checkOrgUrl('https://dev.azure.com/contoso/Project/_boards/board'), 'https://dev.azure.com/contoso')
  assert.equal(checkOrgUrl('https://contoso.visualstudio.com/'), 'https://contoso.visualstudio.com')
  for (const bad of [
    'https://evil.example/contoso',
    'http://dev.azure.com/contoso', // no plain http
    'https://dev.azure.com.evil.example/x',
    'https://evil.example/?dev.azure.com',
    'https://user:pw@dev.azure.com/contoso',
    'https://dev.azure.com:8443/contoso',
    'https://dev.azure.com/',
    'file:///C:/x',
    '//evil/share',
    'http://localhost:7071/mockorg' // only with allowLocal
  ])
    assert.throws(() => checkOrgUrl(bad), undefined, bad)
  assert.equal(checkOrgUrl('http://localhost:7071/mockorg', true), 'http://localhost:7071/mockorg')
})

test('client refuses a non-ADO org even when handed the saved token', () => {
  assert.throws(() => new AdoClient({ orgUrl: 'https://attacker.example', project: '', team: '', pat: 'secret' }))
})

test('ids and field names are validated before touching URLs or patch paths', async () => {
  assert.equal(assertId(42), 42)
  for (const bad of [0, -1, 1.5, NaN, '42', '../_apis', null]) assert.throws(() => assertId(bad as never))
  const c = new AdoClient({ orgUrl: 'https://dev.azure.com/contoso', project: 'p', team: '', pat: 'x' })
  await assert.rejects(c.updateItem(1, { '../../relations/-': 'x' }))
  await assert.rejects(c.getComments('1/../../x' as never))
})

test('after a crash/reboot the open session ends at the last save and focus becomes paused', () => {
  const lastSave = Date.now() - 8 * 3600e3 // laptop was off overnight
  const state: AppState = {
    focus: { itemId: 7, title: 'Thing', startedAt: lastSave - 3600e3, confirmedAt: lastSave },
    paused: null,
    sessions: [{ id: 's', itemId: 7, start: lastSave - 3600e3 }],
    unplanned: [], inbox: [], notes: {}, plans: {}, eod: {}, wins: [], titles: {},
    savedAt: lastSave
  }
  const t = new Tracker({ state, saveState() {}, flush() {} } as never)
  assert.equal(t.s.focus, null)
  assert.equal(t.s.paused?.focus.itemId, 7)
  assert.equal(t.s.sessions[0].end, lastSave, 'downtime is not counted')
})
