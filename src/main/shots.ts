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
  const links = await d.main()?.webContents.executeJavaScript(`({
    tiles: document.querySelectorAll('.tile .open-ado').length,
    board: [...document.querySelectorAll('.page-head button')].some((b) => /ADO board/.test(b.textContent ?? ''))
  })`)
  console.log('ado-links', JSON.stringify(links))
  if (!links?.tiles || !links?.board) {
    console.error('LINKS CHECK FAILED: open-in-ADO buttons missing on the board')
    failed = true
  }

  // moving the PBI to Committed hits the mock's "Effort required" rule → the fields prompt
  await d.main()?.webContents.executeJavaScript(`(() => {
    const sel = [...document.querySelectorAll('.tile select')].find((s) => [...s.options].some((o) => o.value === 'Committed'))
    if (!sel) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'Committed')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await wait(1500)
  const prompt = await d.main()?.webContents.executeJavaScript(`document.querySelector('.modal h2')?.textContent ?? ''`)
  console.log('needs-fields-prompt', JSON.stringify(prompt))
  if (!/needs a bit more/.test(String(prompt))) {
    console.error('FIELDS CHECK FAILED: no required-fields prompt after a rule error')
    failed = true
  }
  await snap(d.main(), '03b-needs-fields')
  await esc()

  // drag and drop on the board (synthetic HTML5 drag events, one step per React render)
  const js = (code: string): Promise<unknown> => d.main()!.webContents.executeJavaScript(code)
  const dragTo = async (id: number, col: string, name: string): Promise<void> => {
    await js(`window.__dt = new DataTransfer(); document.querySelector('.tile[data-id="${id}"]')?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`)
    await wait(150)
    await js(`(() => { const c = document.querySelector('.column[data-col="${col}"]'); for (const t of ['dragenter', 'dragover']) c.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: 640, clientY: 360 })) })()`)
    await wait(250)
    await snap(d.main(), name)
  }
  const dropOn = async (id: number, col: string): Promise<void> => {
    await js(`(() => { const c = document.querySelector('.column[data-col="${col}"]'); c.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: 640, clientY: 360 })); document.querySelector('.tile[data-id="${id}"]')?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt })) })()`)
    await wait(1500)
  }
  const inColumn = (id: number, col: string): Promise<unknown> => js(`!!document.querySelector('.column[data-col="${col}"] .tile[data-id="${id}"]')`)
  const outlined = (col: string, cls: string): Promise<unknown> => js(`document.querySelector('.column[data-col="${col}"]')?.classList.contains('${cls}') ?? false`)

  // the board shows the team's ADO columns, in board order
  const heads = await js(`[...document.querySelectorAll('.board .column h3 .ellipsis')].map((h) => h.textContent)`)
  console.log('board-columns', JSON.stringify(heads))
  if (JSON.stringify(heads) !== '["New","Ready","Dev","Test","Review","Closed"]') {
    console.error('BOARD CHECK FAILED: columns are not the ADO board columns')
    failed = true
  }
  // 1. a New story onto Dev: outlined, then moved (state → Active)
  await dragTo(4106, 'ado:Dev', '03c-drag-over')
  const ok1 = await outlined('ado:Dev', 'drop-ok')
  await dropOn(4106, 'ado:Dev')
  const moved = await inColumn(4106, 'ado:Dev')
  // 2. a PBI over Review: the board has no PBI state there, so the column refuses it
  await dragTo(4110, 'ado:Review', '03d-drag-blocked')
  const blocked = await outlined('ado:Review', 'drop-no')
  await dropOn(4110, 'ado:Review')
  const stayed = await inColumn(4110, 'ado:Ready')
  // 3. an Active story from Dev to Test: same state, only the board column changes
  await dragTo(4102, 'ado:Test', '03e-drag-column')
  await dropOn(4102, 'ado:Test')
  await js(`window.tl.call('getItem', 4102).then((i) => (window.__moved = i))`)
  await wait(500)
  const colOnly = (await js(`window.__moved && { state: window.__moved.state, column: window.__moved.boardColumn }`)) as { state?: string; column?: string }
  const inTest = await inColumn(4102, 'ado:Test')
  // 4. a Task (not on the story board) goes by state category: Active → the first in-progress column
  const taskInDev = await inColumn(4103, 'ado:Dev')
  console.log('dnd-check', JSON.stringify({ ok1, moved, blocked, stayed, colOnly, inTest, taskInDev }))
  if (!ok1 || !moved || !blocked || !stayed || colOnly?.state !== 'Active' || colOnly?.column !== 'Test' || !inTest || !taskInDev) {
    console.error('DND CHECK FAILED')
    failed = true
  }
  await route({ view: 'search' })
  await snap(d.main(), '04-search')
  await route({ view: 'item', id: 4105 })
  await snap(d.main(), '05-item')
  await esc()

  // the org-added "Time Estimate" field (found by name) shows in the drawer with its value
  const [estId] = (await js(
    `window.tl.call('search', { text: 'Register app in Entra', status: 'any', assigned: 'anyone' }).then(r => r.map(i => i.id))`
  )) as number[]
  await route({ view: 'item', id: estId })
  await wait(1200)
  const est = await js(`(() => {
    const dt = [...document.querySelectorAll('.drawer dl.props dt')].find((x) => x.textContent === 'Time Estimate')
    return dt ? dt.nextElementSibling?.querySelector('input')?.value ?? 'no input' : 'missing'
  })()`)
  console.log('time-estimate-drawer', JSON.stringify(est))
  if (est !== '5') {
    console.error('FIELDS CHECK FAILED: Time Estimate not shown in the item drawer')
    failed = true
  }
  await snap(d.main(), '05a-item-estimate')
  await esc()

  // parent picker: a story (4114) gets a parent. Chips default to the level above; the project toggle widens the search.
  const parentDd = `[...document.querySelectorAll('.drawer dl.props dt')].find((x) => x.textContent === 'Parent')?.nextElementSibling`
  const pickerIds = (): Promise<number[]> => js(`[...document.querySelectorAll('.modal .pick .mono')].map((x) => Number(x.textContent))`) as Promise<number[]>
  const clickIn = (sel: string, text: string): Promise<unknown> =>
    js(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.click()`)
  const parentOf = (id: number): Promise<number | undefined> => js(`window.tl.call('getItem', ${id}).then((i) => i.parentId)`) as Promise<number | undefined>
  const openParentPicker = async (): Promise<void> => {
    await js(`(${parentDd})?.querySelector('button')?.click()`)
    await wait(1500)
  }
  await route({ view: 'item', id: 4114 })
  await wait(1200)
  const noParent = await js(`(${parentDd})?.textContent ?? 'missing'`)
  await openParentPicker()
  const onChips = (await js(`[...document.querySelectorAll('.modal .chip.on')].map((x) => x.textContent)`)) as string[]
  const allChips = (await js(`[...document.querySelectorAll('.modal .chip')].map((x) => x.textContent)`)) as string[]
  const first = await pickerIds()
  await snap(d.main(), '05c-parent-picker')
  await js(`document.querySelector('.modal input[type=checkbox]')?.click()`)
  await wait(1500)
  const wide = await pickerIds()
  await clickIn('.modal .chip', 'Epic')
  await wait(1500)
  const withEpics = await pickerIds()
  await snap(d.main(), '05d-parent-picker-wide')
  // a story under an Epic: Azure DevOps refuses, the card keeps no parent and the reason is shown
  await js(`[...document.querySelectorAll('.modal .pick')].find((x) => x.textContent.includes('Self-service onboarding'))?.click()`)
  await wait(1500)
  const refused = (await js(`document.querySelector('.toast.error')?.textContent ?? ''`)) as string
  const stillNone = (await parentOf(4114)) === undefined
  // a valid parent
  await openParentPicker()
  await js(`[...document.querySelectorAll('.modal .pick')].find((x) => x.textContent.includes('SSO session timeouts'))?.click()`)
  await wait(1500)
  const set = (await parentOf(4114)) === 4130
  const shownParent = (await js(`(${parentDd})?.textContent ?? ''`)) as string
  await snap(d.main(), '05e-item-parent')
  // replace it: the current parent is not offered; the old link is removed in the same request
  await openParentPicker()
  const offered = await pickerIds()
  await js(`[...document.querySelectorAll('.modal .pick')].find((x) => x.textContent.includes('SSO for partner portal'))?.click()`)
  await wait(1500)
  const replaced = (await parentOf(4114)) === 4101
  // Esc closes only the picker, then the ✕ removes the parent
  await openParentPicker()
  await esc()
  await wait(300)
  const escOk = (await js(`!document.querySelector('.modal') && !!document.querySelector('.drawer')`)) === true
  await js(`(${parentDd})?.querySelector('button[title="Remove the parent link"]')?.click()`)
  await wait(1500)
  const removed = (await parentOf(4114)) === undefined
  console.log('parent-check', JSON.stringify({ noParent, onChips, allChips, first, wide, withEpics, refused, stillNone, set, shownParent, offered, replaced, escOk, removed }))
  const has = (a: number[], ...ids: number[]): boolean => ids.every((i) => a.includes(i))
  const lacks = (a: number[], ...ids: number[]): boolean => ids.every((i) => !a.includes(i))
  if (
    !/none/.test(String(noParent)) ||
    onChips.join() !== 'Feature' ||
    allChips.join() !== 'Bug,Product Backlog Item,User Story,Feature,Epic' ||
    !has(first, 4101, 4130, 4131) ||
    !lacks(first, 4100, 4114, 4116, 4132, 4133) ||
    !has(wide, 4116) ||
    !lacks(wide, 4132) ||
    !has(withEpics, 4100, 4132) ||
    !/circular|cannot be the parent/.test(refused) ||
    !stillNone ||
    !set ||
    !/4130/.test(shownParent) ||
    !lacks(offered, 4130) ||
    !has(offered, 4101) ||
    !replaced ||
    !escOk ||
    !removed
  ) {
    console.error('PARENT CHECK FAILED')
    failed = true
  }
  // changed in Azure DevOps itself: the refresh button picks it up, title included
  d.main()?.setContentSize(620, 600)
  await wait(500)
  await route({ view: 'work' })
  await wait(800)
  await snap(d.main(), '03f-board-narrow')
  await route({ view: 'item', id: 4110 })
  await wait(1000)
  await snap(d.main(), '05g-drawer-narrow')
  d.main()?.setContentSize(1280, 800)
  await wait(500)
  await route({ view: 'item', id: 4114 })
  await wait(1000)
  const outsideEdit = await fetch('http://localhost:7071/mockorg/_apis/wit/workitems/4114?api-version=7.1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json', Authorization: `Basic ${Buffer.from(':mock-pat').toString('base64')}` },
    body: JSON.stringify([{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'http://localhost:7071/mockorg/_apis/wit/workItems/4131' } }])
  })
  const hadBtn = await js(`!!document.querySelector('.drawer button[title="Refresh from Azure DevOps"]')`)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }))`)
  await wait(1500)
  const outside = (await js(`(${parentDd})?.textContent ?? ''`)) as string
  console.log('refresh-check', JSON.stringify({ outside, hadBtn, status: outsideEdit.status, body: (await outsideEdit.text()).slice(0, 200) }))
  if (!/4131 Audit and compliance/.test(outside)) {
    console.error('PARENT CHECK FAILED: F5 refresh did not show a parent set outside Golau')
    failed = true
  }
  // editing the other fields from the card panel: assignee, sprint, area, tags, priority, work hours
  const dd = (label: string): string => `[...document.querySelectorAll('.drawer dl.props dt')].find((x) => x.textContent === ${JSON.stringify(label)})?.nextElementSibling`
  const typeInto = (sel: string, value: string, key?: string): Promise<unknown> =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) return false
      el.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      ${key ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))` : ''}
      return true
    })()`)
  const field = (id: number): Promise<Record<string, unknown>> =>
    js(`window.tl.call('getItem', ${id}).then((i) => ({ who: i.assignedTo?.name, sprint: i.iterationPath, area: i.areaPath, tags: i.tags, prio: i.priority, rem: i.remainingWork, done: i.completedWork }))`) as Promise<Record<string, unknown>>
  const rows = (): Promise<string[]> => js(`[...document.querySelectorAll('.modal .pick')].map((x) => x.textContent.trim())`) as Promise<string[]>
  const pickRow = (text: string): Promise<unknown> => js(`[...document.querySelectorAll('.modal .pick')].find((x) => x.textContent.includes(${JSON.stringify(text)}))?.click()`)
  const openChange = async (label: string): Promise<void> => {
    await js(`(${dd(label)})?.querySelector('button.btn:last-of-type')?.click()`)
    await wait(1200)
  }
  await route({ view: 'item', id: 4114 })
  await wait(1200)
  await openChange('Assigned')
  const whoRows = await rows()
  await snap(d.main(), '05h-assignee-picker')
  await typeInto('.modal input', 'priya')
  await wait(300)
  const filtered = await rows()
  await pickRow('Priya Patel')
  await wait(1500)
  const assigned = (await field(4114)).who
  await openChange('Assigned')
  await pickRow('Unassigned')
  await wait(1500)
  const unassigned = (await field(4114)).who
  await openChange('Iteration')
  const sprintRows = await rows()
  await pickRow('Sprint 43')
  await wait(1500)
  const sprint = (await field(4114)).sprint
  await openChange('Area')
  await pickRow('Platform\\Core\\Auth')
  await wait(1500)
  const area = (await field(4114)).area
  await typeInto(`.drawer input[list=tag-ideas]`, 'api, brand new', 'Enter')
  await wait(1500)
  const tagsAdded = (await field(4114)).tags as string[]
  await js(`[...(${dd('Tags')}).querySelectorAll('.pill')].find((x) => x.textContent.trim() === 'brand new')?.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(1500)
  const tagsRemoved = (await field(4114)).tags as string[]
  await js(`(() => { const s = (${dd('Priority')})?.querySelector('select'); if (!s) return; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await wait(1500)
  const prio = (await field(4114)).prio
  await snap(d.main(), '05i-fields-edited')
  // work hours on a Task: clear and set again
  await route({ view: 'item', id: 4108 })
  await wait(1200)
  await js(`(() => { const i = (${dd('Remaining (h)')})?.querySelector('input'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })()`)
  await wait(1500)
  const remCleared = (await field(4108)).rem
  await js(`(() => { const i = (${dd('Remaining (h)')})?.querySelector('input'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '5'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })()`)
  await wait(1500)
  const remSet = (await field(4108)).rem
  // a sprint that is not in the project is refused with ADO's own message
  const badSprint = (await js(`window.tl.call('updateItem', 4114, { 'System.IterationPath': 'Platform\\Nope' })`)) as { ok: boolean; message?: string }
  console.log('fields-check', JSON.stringify({ whoRows, filtered, assigned, unassigned, sprintRows, sprint, area, tagsAdded, tagsRemoved, prio, remCleared, remSet, badSprint }))
  if (
    !['Me', 'Unassigned', 'Priya Patel', 'Sam Rivera'].every((n) => whoRows.some((r) => r.includes(n))) ||
    filtered.length !== 1 ||
    assigned !== 'Priya Patel' ||
    unassigned !== undefined ||
    !sprintRows[0].includes('Sprint 42') ||
    !sprintRows[0].includes('current') ||
    sprint !== 'Platform\\Sprint 43' ||
    area !== 'Platform\\Core\\Auth' ||
    !(tagsAdded.includes('api') && tagsAdded.includes('brand new')) ||
    tagsRemoved.includes('brand new') ||
    !tagsRemoved.includes('api') ||
    prio !== 1 ||
    remCleared !== undefined ||
    remSet !== 5 ||
    badSprint.ok ||
    !/TF401347/.test(String(badSprint.message))
  ) {
    console.error('FIELDS EDIT CHECK FAILED')
    failed = true
  }
  // a card that already breaks a rule (the mock PBI has no Customer): re-parenting asks for it, like any other edit
  await route({ view: 'item', id: 4110 })
  await wait(1200)
  await openParentPicker()
  await js(`[...document.querySelectorAll('.modal .pick')].find((x) => x.textContent.includes('SSO session timeouts'))?.click()`)
  await wait(1500)
  const needsFields = /needs a bit more/.test(String(await js(`document.querySelector('.modal h2')?.textContent ?? ''`)))
  await snap(d.main(), '05f-parent-needs-fields')
  if (!needsFields) {
    console.error('PARENT CHECK FAILED: no required-fields prompt when re-parenting a card with a rule error')
    failed = true
  }
  await esc()
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
  await wait(800)
  const estLabel = await js(`[...document.querySelectorAll('.modal label.field')].some((l) => /^Time Estimate/.test(l.textContent ?? ''))`)
  console.log('time-estimate-create', estLabel)
  if (!estLabel) {
    console.error('FIELDS CHECK FAILED: Time Estimate not offered on the create form')
    failed = true
  }
  await snap(d.main(), '09-create')
  // a parent with a long title must not push into the Tags field, at any window width
  const overlapping = `(() => {
    const r = [...document.querySelectorAll('.modal label.field')].map((l) => l.getBoundingClientRect())
    const boxes = r.some((a, i) => r.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1))
    // content spilling out of its own field, or the form scrolling sideways
    const spill = [...document.querySelectorAll('.modal label.field')].some((l) => [...l.querySelectorAll('*')].some((c) => c.getBoundingClientRect().right > l.getBoundingClientRect().right + 1))
    const m = document.querySelector('.modal')
    return boxes || spill || (!!m && m.scrollWidth > m.clientWidth + 1)
  })()`
  for (const [w, h, name] of [[1280, 800, '09c-create-parent'], [620, 700, '09d-create-parent-narrow']] as const) {
    await esc()
    await wait(300)
    d.main()?.setContentSize(w, h)
    await route({ view: 'create', prefill: { title: 'Child card', parentId: 4111 } })
    await wait(1200)
    const lap = await js(overlapping)
    console.log('create-parent-layout', w, JSON.stringify(lap))
    if (lap) {
      console.error(`LAYOUT CHECK FAILED: create form fields overlap at ${w}px`)
      failed = true
    }
    await snap(d.main(), name)
    await esc()
  }
  d.main()?.setContentSize(1280, 800)
  await wait(400)
  await esc()

  // a type whose process requires Description + Customer: the form shows them and blocks an empty submit
  await route({ view: 'create', prefill: { type: 'Product Backlog Item', title: 'Export audit events as CSV' } })
  await wait(1200)
  await d.main()?.webContents.executeJavaScript(`document.querySelector('.modal form .btn.primary')?.click()`)
  await wait(600)
  const marked = await d.main()?.webContents.executeJavaScript(`document.querySelectorAll('.modal .field-error').length`)
  console.log('create-required-errors', marked)
  if (!(Number(marked) >= 2)) {
    console.error('FIELDS CHECK FAILED: create form did not flag required fields')
    failed = true
  }
  await snap(d.main(), '09b-create-required')
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
