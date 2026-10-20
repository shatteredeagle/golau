import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Nudge, Route } from '../shared/types'
import type { Store } from './store'
import type { Tracker } from './tracker'

/**
 * Dev-only: GOLAU_SHOTS=<dir> renders every screen offscreen against the mock ADO server
 * and writes PNGs. Lets us review UI changes without a display.
 */
export interface ShotDeps {
  store: Store
  tracker: Tracker
  showMain: (r?: Route) => void
  main: () => BrowserWindow | null
  showNudge: (n: Nudge) => void
  nudge: () => BrowserWindow | null
  mini: () => BrowserWindow | null
  showCapture: () => void
  capture: () => BrowserWindow | null
  suggestCards: (text: string) => Promise<{ id: number; title: string; type: string }[]>
  refresh: () => Promise<unknown>
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runShots(d: ShotDeps, dir: string): Promise<void> {
  let failed = false
  mkdirSync(dir, { recursive: true })
  // never hang CI: give up loudly if a step stalls
  const watchdog = setTimeout(() => {
    console.error('SHOTS FAILED: timed out')
    app.exit(2)
  }, 180000)
  watchdog.unref()
  const snap = async (win: BrowserWindow | null, name: string): Promise<void> => {
    if (!win) return console.log(`skip ${name}: no window`)
    await wait(900)
    console.log(`capturing ${name}`)
    const img = await Promise.race([
      win.webContents.capturePage(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`capturePage timed out on ${name}`)), 15000))
    ])
    writeFileSync(join(dir, `${name}.png`), img.toPNG())
    console.log(`shot ${name}`)
  }
  const route = async (r: Route): Promise<void> => {
    d.main()?.webContents.send('route', r)
    await wait(400)
  }
  const esc = async (): Promise<void> => {
    await d.main()?.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))`)
    await wait(200)
  }

  // 1. first run (GOLAU_SHOTS_SIZE=WxH renders at another window size, e.g. a laptop)
  d.showMain()
  const size = /^(\d+)x(\d+)$/.exec(process.env.GOLAU_SHOTS_SIZE ?? '')
  if (size) d.main()?.setContentSize(Number(size[1]), Number(size[2]))
  await wait(1500)
  await snap(d.main(), '01-setup')

  // 2. connect to the mock and seed a believable day
  d.store.setSecret('pat', 'mock-pat')
  d.store.saveSettings({ orgUrl: 'http://localhost:7071/mockorg', project: 'Platform', team: 'Platform Team', theme: (process.env.GOLAU_THEME as 'dark' | 'light') ?? 'dark' })
  await d.refresh()
  const now = Date.now()
  const s = d.tracker.s
  const uId = randomUUID()
  s.unplanned.push({ id: uId, text: 'Helped Sam debug the staging deploy', createdAt: now - 3 * 3600e3 })
  s.sessions.push(
    { id: randomUUID(), itemId: 4103, start: now - 4 * 3600e3, end: now - 3.2 * 3600e3 },
    { id: randomUUID(), unplannedId: uId, start: now - 3 * 3600e3, end: now - 2.6 * 3600e3 },
    { id: randomUUID(), itemId: 4105, start: now - 2.5 * 3600e3, end: now - 1.4 * 3600e3 }
  )
  s.wins.push({ at: now - 3.1 * 3600e3, itemId: 4109, title: 'Update pipeline to Node 24', kind: 'closed' }, { at: now - 2 * 3600e3, itemId: 4105, title: 'Login redirect loops when cookie is stale', kind: 'commented' })
  s.notes[4102] = { text: 'OIDC callback works locally, next: token refresh', at: now }
  s.inbox.push({ id: randomUUID(), text: 'Ask Priya about the audit log retention policy', createdAt: now - 3600e3 }, { id: randomUUID(), text: 'Rename the flaky test job', createdAt: now - 600e3 })
  d.tracker.setPlan({ itemIds: [4102, 4105, 4106] })
  d.tracker.startItem({ id: 4102, title: 'Partner can sign in with Entra ID', type: 'User Story', state: 'Active' })
  s.focus!.startedAt = now - 42 * 60e3
  d.main()?.webContents.reload()
  await wait(2000)
  await snap(d.main(), '02-today')

  await route({ view: 'work' })
  await snap(d.main(), '03-board')
  await route({ view: 'search' })
  await snap(d.main(), '04-search')
  await route({ view: 'item', id: 4105 })
  await snap(d.main(), '05-item')
  await esc()

  // security check: hostile work item HTML must come out inert
  const ids = (await d.main()?.webContents.executeJavaScript(
    `window.tl.call('search', { text: 'Hostile', status: 'any', assigned: 'anyone' }).then(r => r.map(i => i.id))`
  )) as number[]
  if (!ids?.length) {
    console.error('SECURITY CHECK FAILED: hostile test item not found in mock')
    failed = true
  } else {
    await route({ view: 'item', id: ids[0] })
    await wait(1200)
    const report = await d.main()?.webContents.executeJavaScript(`(() => {
      const box = [...document.querySelectorAll('.drawer .html')][0]
      if (!box) return { error: 'no description rendered' }
      return {
        imgs: box.querySelectorAll('img').length,
        hrefs: [...box.querySelectorAll('a')].map(a => a.getAttribute('href')),
        dangerous: box.querySelectorAll('iframe,svg,form,input,script,[onerror],[onload]').length
      }
    })()`)
    console.log('security-check', JSON.stringify(report))
    const r = report as { error?: string; imgs?: number; dangerous?: number; hrefs?: (string | null)[] }
    const badHref = (r.hrefs ?? []).some((h) => h !== null && !/^https:\/\//.test(h))
    if (r.error || r.imgs || r.dangerous || badHref || !(r.hrefs ?? []).includes('https://example.com/ok')) {
      console.error('SECURITY CHECK FAILED: hostile work item HTML was not neutralised')
      failed = true
    }
    await snap(d.main(), '05b-hostile-item')
    await esc()
  }
  await route({ view: 'today' })
  await route({ view: 'pick' })
  await snap(d.main(), '06-pick')
  await esc()
  await route({ view: 'plan' })
  await snap(d.main(), '07-plan')
  await esc()
  await route({ view: 'eod' })
  await snap(d.main(), '08-eod')
  await esc()
  await route({ view: 'create', prefill: { title: 'Helped Sam debug the staging deploy' }, fromUnplanned: uId })
  await snap(d.main(), '09-create')
  await esc()
  await route({ view: 'stale' })
  await snap(d.main(), '10-stale')
  await esc()
  await route({ view: 'inbox' })
  await snap(d.main(), '11-inbox')
  await route({ view: 'settings' })
  await snap(d.main(), '12-settings')

  // floating surfaces
  await snap(d.mini(), '13-mini')
  d.showNudge({
    id: 'n1',
    kind: 'checkin',
    title: 'Still on this?',
    body: '#4102 Partner can sign in with Entra ID\n42m so far',
    timeout: 90,
    actions: [
      { id: 'yes', label: 'Yep', primary: true, onTimeout: true },
      { id: 'switch', label: 'Switched' },
      { id: 'break', label: 'Break' },
      { id: 'done', label: 'Finished it' }
    ]
  })
  await wait(800)
  await snap(d.nudge(), '14-nudge-checkin')
  d.showNudge({
    id: 'n2',
    kind: 'unplanned-card',
    title: 'Is there a card for this?',
    body: '"Fix login cookie in staging" has been going 25m.',
    suggestions: await d.suggestCards('Fix login cookie in staging'),
    actions: [
      { id: 'create', label: 'Make a card', primary: true },
      { id: 'find', label: 'Find one…' },
      { id: 'kept', label: 'No card needed' },
      { id: 'later', label: 'Ask later' }
    ]
  })
  await wait(800)
  await snap(d.nudge(), '15-nudge-unplanned')
  d.showNudge({
    id: 'n3',
    kind: 'nofocus',
    title: 'What are you working on?',
    body: "3 cards on today's plan.",
    data: { input: true },
    actions: [
      { id: 'pick', label: 'Pick a card', primary: true },
      { id: 'unplanned', label: 'Track it' },
      { id: 'away', label: 'Not working' },
      { id: 'later', label: 'Later', onTimeout: true }
    ]
  })
  await wait(800)
  await snap(d.nudge(), '16-nudge-nofocus')
  d.showCapture()
  await wait(600)
  await snap(d.capture(), '17-capture')

  d.store.flush()
  app.exit(failed ? 1 : 0)
}
