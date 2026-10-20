// Run: node --test test/
// Exercises nudge rules with a fake clock and fake idle time; no Electron needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Scheduler } from '../src/main/scheduler.ts'
import { Tracker } from '../src/main/tracker.ts'
import type { AppState, Nudge, Settings, WorkItem } from '../src/shared/types.ts'

const settings: Settings = {
  orgUrl: 'x', project: 'p', team: '', hasPat: true,
  checkInMinutes: 45, noFocusMinutes: 15, unplannedAskMinutes: 20, staleDays: 3, hyperfocusMinutes: 90, idleMinutes: 10,
  workStart: '00:00', workEnd: '23:59', eodTime: '23:58', workDays: [0, 1, 2, 3, 4, 5, 6],
  nudgesEnabled: true, morningPlan: false, eodCheckIn: false, logCompletedWork: false,
  captureHotkey: '', showMini: false, closeToTray: true, launchAtLogin: false, theme: 'dark',
  busybar: { enabled: false, host: '', hasKey: false, priority: 40 }
}

function setup(over: Partial<Settings> = {}, work: WorkItem[] = []) {
  const state: AppState = { focus: null, paused: null, sessions: [], unplanned: [], inbox: [], notes: {}, plans: {}, eod: {}, wins: [], titles: {} }
  const store = { state, saveState() {}, flush() {} }
  const tracker = new Tracker(store as never)
  let idle = 0
  const shown: Nudge[] = []
  const s = { ...settings, ...over }
  const sched = new Scheduler({
    settings: () => s,
    tracker,
    idleSeconds: () => idle,
    myWork: () => work,
    isNudgeShowing: () => false,
    show: (n) => shown.push(n),
    suggestCards: async () => [{ id: 1, title: 'Fix login', type: 'Bug' }]
  })
  return { tracker, sched, shown, setIdle: (v: number) => (idle = v), state }
}

const MIN = 60000

test('check-in only after the interval, then backs off', async () => {
  const { tracker, sched, shown } = setup()
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  const t0 = tracker.s.focus!.startedAt
  await sched.tick(t0 + 30 * MIN)
  assert.equal(shown.length, 0)
  await sched.tick(t0 + 46 * MIN)
  assert.equal(shown.at(-1)?.kind, 'checkin')
  await sched.tick(t0 + 47 * MIN)
  assert.equal(shown.length, 1, 'no repeat right away')
})

test('idle pauses the timer at the moment you walked away', async () => {
  const { tracker, sched, setIdle } = setup()
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  const now = Date.now() + 20 * MIN
  setIdle(12 * 60)
  await sched.tick(now)
  assert.equal(tracker.s.focus, null)
  assert.equal(tracker.s.paused?.reason, 'idle')
  const end = tracker.s.sessions[0].end!
  assert.ok(Math.abs(end - (now - 12 * MIN)) < 1000, 'session ends when idle started')
})

test('coming back from idle offers to resume', async () => {
  const { tracker, sched, shown, setIdle } = setup()
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  setIdle(15 * 60)
  await sched.tick(Date.now())
  setIdle(2)
  await sched.tick(Date.now() + 1000)
  assert.equal(shown.at(-1)?.kind, 'welcome-back')
})

test('unplanned work gets asked about a card once, with suggestions', async () => {
  const { tracker, sched, shown } = setup()
  tracker.startUnplanned('fix login cookie')
  const t0 = tracker.s.focus!.startedAt
  await sched.tick(t0 + 21 * MIN)
  const n = shown.at(-1)!
  assert.equal(n.kind, 'unplanned-card')
  assert.equal(n.suggestions?.[0].id, 1)
})

test('linking unplanned work moves its time to the card and keeps the timer running', () => {
  const { tracker } = setup()
  const e = tracker.startUnplanned('fix login cookie')
  tracker.resolveUnplanned(e.id, 'linked', { id: 42, title: 'Login bug', type: 'Bug' })
  assert.equal(tracker.s.focus?.itemId, 42)
  assert.equal(tracker.s.sessions[0].itemId, 42)
  assert.equal(tracker.s.sessions[0].unplannedId, undefined)
})

test('no focus while active → "what are you working on?" after the threshold', async () => {
  const { sched, shown } = setup()
  const t0 = Date.now()
  await sched.tick(t0)
  await sched.tick(t0 + 10 * MIN)
  assert.equal(shown.length, 0)
  await sched.tick(t0 + 16 * MIN)
  assert.equal(shown.at(-1)?.kind, 'nofocus')
})

test('quiet mode and nudges-off suppress everything', async () => {
  const { tracker, sched, shown } = setup()
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  tracker.setQuiet(Date.now() + 120 * MIN)
  await sched.tick(tracker.s.focus!.startedAt + 60 * MIN)
  assert.equal(shown.length, 0)
})

test('outside work hours: no nudges', async () => {
  const { tracker, sched, shown } = setup({ workDays: [] })
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  await sched.tick(tracker.s.focus!.startedAt + 60 * MIN)
  assert.equal(shown.length, 0)
})

test('morning plan asks at most 3 times a day', async () => {
  const { sched, shown } = setup({ morningPlan: true })
  // start at 09:00 today so 5 simulated hours never cross midnight (CI runs in UTC)
  let t = new Date().setHours(9, 0, 0, 0)
  for (let i = 0; i < 10; i++) {
    await sched.tick(t)
    t += 31 * MIN
  }
  assert.equal(shown.filter((n) => n.kind === 'morning').length, 3)
})

test('hyperfocus break suggestion once per stretch', async () => {
  const { tracker, sched, shown } = setup({ checkInMinutes: 999 })
  tracker.startItem({ id: 7, title: 'Thing', type: 'Task' })
  const t0 = tracker.s.focus!.startedAt
  await sched.tick(t0 + 91 * MIN)
  await sched.tick(t0 + 200 * MIN)
  assert.equal(shown.filter((n) => n.kind === 'hyperfocus').length, 1)
})
