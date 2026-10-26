import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, session, Tray } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { AdoClient, AdoError, assertId, checkOrgUrl } from './ado'
import { DEV, devEnv } from './env'
import { BusyBar } from './busybar'
import { Scheduler } from './scheduler'
import { loadWarnings, Store } from './store'
import { migrateFromOldName, OLD_APP_ID, OLD_NAME } from './migrate'
import { Tracker } from './tracker'
import { createCapture, createMain, createMini, createNudge, isAppUrl, openLink, placeNudge } from './windows'
import { runShots } from './shots'
import { Updater } from './updater'
import { fmtDur } from '../shared/time'
import type { CreateItemInput, Mutation, Nudge, Route, SearchQuery, Settings, WorkItem } from '../shared/types'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.setAppUserModelId('com.golau.app')

// Renamed from Tasklight in 0.2.0: bring the user's settings and token across once.
// Must run before Electron initialises so the copied key file ("Local State") is used.
const startupNotices: string[] = []
let migrated = false
if (!devEnv('GOLAU_DATA')) {
  try {
    const copied = migrateFromOldName(join(app.getPath('appData'), OLD_NAME), app.getPath('userData'))
    if (copied.length) {
      migrated = true
      startupNotices.push(`Welcome to Golau (formerly ${OLD_NAME}). Your settings came along; you can uninstall ${OLD_NAME} from Settings → Apps.`)
    }
  } catch (e) {
    console.warn('migration from Tasklight failed', e)
  }
}

/** Run the downloaded installer (silent, per-user) and quit so it can replace the files; it reopens Golau. */
function installUpdateNow(): boolean {
  if (!updater?.install(true)) return false
  quitting = true
  store?.flush()
  setTimeout(() => app.quit(), 300)
  return true
}

/** Start-with-Windows entry: points at this exe and starts hidden in the tray. */
function applyLoginItem(on: boolean): void {
  if (process.platform === 'win32' || process.platform === 'darwin')
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
}

let store: Store
let tracker: Tracker
let scheduler: Scheduler
let busybar: BusyBar
let updater: Updater
let ado: AdoClient | null = null
let mainWin: BrowserWindow | null = null
let nudgeWin: BrowserWindow | null = null
let miniWin: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null
let tray: Tray | null = null
let currentNudge: Nudge | null = null
let nudgeTimer: NodeJS.Timeout | undefined
let quitting = false

let workCache: WorkItem[] = []
let workFetchedAt = 0
let lastError = ''

const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png')

// ---------- ADO plumbing ----------

function client(): AdoClient {
  const s = store.settings
  if (!s.orgUrl || !store.pat) throw new AdoError('Not connected yet. Add your org URL and PAT in Settings.', 0)
  ado ??= new AdoClient({ orgUrl: s.orgUrl, project: s.project, team: s.team, pat: store.pat, allowLocal: DEV })
  return ado
}

function resetClient(): void {
  ado = null
  workCache = []
  workFetchedAt = 0
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn()
    if (lastError) {
      lastError = ''
      broadcast('conn', '')
    }
    return r
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof TypeError || /fetch failed|timeout|ENOTFOUND|ECONN/i.test(msg)) {
      lastError = 'Offline: can\'t reach Azure DevOps'
      broadcast('conn', lastError)
    } else if (e instanceof AdoError && e.status === 401) {
      lastError = msg
      broadcast('conn', lastError)
    }
    throw e
  }
}

async function myWork(force = false): Promise<WorkItem[]> {
  if (!store.settings.orgUrl || !store.pat || !store.settings.project) return []
  if (!force && workFetchedAt && Date.now() - workFetchedAt < 60000) return workCache
  workCache = await guarded(() => client().myWork())
  workFetchedAt = Date.now()
  for (const i of workCache) tracker.cacheTitle(i.id, i.title, i.type, i.state)
  broadcast('work', workCache)
  return workCache
}

function touchCache(item: WorkItem): void {
  tracker.cacheTitle(item.id, item.title, item.type, item.state)
  const i = workCache.findIndex((x) => x.id === item.id)
  if (i >= 0) workCache[i] = item
  else if (item.assignedTo?.email && item.assignedTo.email === workCache[0]?.assignedTo?.email) workCache.unshift(item)
  broadcast('work', workCache)
  // keep the focus label in sync with renames
  if (tracker.s.focus?.itemId === item.id && tracker.s.focus.title !== item.title) {
    tracker.s.focus.title = item.title
    tracker.emit('change', tracker.s)
  }
}

const STOP = new Set('the and for with from that this into have will been about fix bug task card work some'.split(' '))

async function suggestCards(text: string): Promise<{ id: number; title: string; type: string }[]> {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))]
  if (!words.length) return []
  const scored = new Map<number, { item: WorkItem; score: number }>()
  const consider = (item: WorkItem, bonus: number): void => {
    if (item.category === 'Completed' || item.category === 'Removed') return
    const t = item.title.toLowerCase()
    const score = words.filter((w) => t.includes(w)).length + bonus
    if (score > bonus) scored.set(item.id, { item, score: Math.max(score, scored.get(item.id)?.score ?? 0) })
  }
  for (const i of await myWork().catch(() => workCache)) consider(i, 0.5)
  if (scored.size < 3) {
    const longest = [...words].sort((a, b) => b.length - a.length).slice(0, 2)
    for (const w of longest) {
      const found = await client().search({ text: w, status: 'active', assigned: 'anyone' }).catch(() => [])
      found.slice(0, 10).forEach((i) => consider(i, 0))
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ item }) => ({ id: item.id, title: item.title, type: item.type }))
}

/** Plain text typed into an HTML field (Description, Acceptance Criteria…) becomes safe HTML. */
async function normalizeFields(type: string, project: string | undefined, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const specs = await client().typeFields(type, project).catch(() => [])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    const spec = specs.find((s) => s.referenceName === k)
    out[k] = spec?.kind === 'html' && typeof v === 'string' && !v.trimStart().startsWith('<') ? toHtml(v) : v
  }
  return out
}

/** Rule failures (required/invalid fields) come back as data the UI can act on; anything else still throws. */
async function asMutationError(e: unknown, type: string | undefined, project?: string): Promise<Mutation<never>> {
  if (e instanceof AdoError && e.status === 400 && type) {
    const fieldErrors = await client().explainRuleErrors(e, type, project)
    if (fieldErrors.length) {
      const names = fieldErrors.map((f) => f.name).join(', ')
      const required = fieldErrors.every((f) => f.required)
      return { ok: false, message: required ? `Azure DevOps needs: ${names}` : `Azure DevOps rejected: ${names}`, fieldErrors }
    }
    return { ok: false, message: e.message, fieldErrors: [] }
  }
  throw e
}

const toHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n/)
    .map((l) => `<div>${l || '<br>'}</div>`)
    .join('')

// ---------- broadcasting ----------

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function onStateChange(): void {
  broadcast('state', tracker.s)
  updateTray()
  syncMini()
  void busybar.update(tracker.s).catch((e) => console.warn(String(e)))
}

// ---------- windows ----------

function showMain(route?: Route): void {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createMain(nativeImage.createFromPath(iconPath()))
    mainWin.on('close', (e) => {
      if (!quitting && store.settings.closeToTray) {
        e.preventDefault()
        mainWin?.hide()
      }
    })
    if (route) mainWin.webContents.once('did-finish-load', () => mainWin?.webContents.send('route', route))
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
  if (route) mainWin.webContents.send('route', route)
}

function syncMini(): void {
  const want = store.settings.showMini && (!!tracker.s.focus || !!tracker.s.paused)
  if (want && (!miniWin || miniWin.isDestroyed())) {
    miniWin = createMini(store.settings.miniPos)
    miniWin.once('ready-to-show', () => miniWin?.showInactive())
    miniWin.on('moved', () => {
      const [x, y] = miniWin!.getPosition()
      store.saveSettings({ miniPos: { x, y } })
    })
  } else if (!want && miniWin && !miniWin.isDestroyed()) {
    miniWin.destroy()
    miniWin = null
  }
}

function showNudge(n: Nudge): void {
  currentNudge = n
  if (!nudgeWin || nudgeWin.isDestroyed()) {
    nudgeWin = createNudge()
    nudgeWin.webContents.once('did-finish-load', () => {
      nudgeWin?.webContents.send('nudge', n)
    })
  } else {
    nudgeWin.webContents.send('nudge', n)
  }
  placeNudge(nudgeWin, 220)
  nudgeWin.showInactive()
  clearTimeout(nudgeTimer)
  if (n.timeout) {
    nudgeTimer = setTimeout(() => {
      const def = n.actions.find((a) => a.onTimeout)
      if (currentNudge?.id === n.id) void nudgeAction(n.id, def?.id ?? 'dismiss', { ignored: true })
    }, n.timeout * 1000)
  }
}

function hideNudge(): void {
  clearTimeout(nudgeTimer)
  currentNudge = null
  nudgeWin?.hide()
}

function showCapture(): void {
  if (!captureWin || captureWin.isDestroyed()) captureWin = createCapture()
  const show = (): void => {
    captureWin?.show()
    captureWin?.focus()
    captureWin?.webContents.send('capture-open')
  }
  if (captureWin.webContents.isLoading()) captureWin.webContents.once('did-finish-load', show)
  else show()
}

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const key = store.settings.captureHotkey
  if (!key) return
  try {
    if (!globalShortcut.register(key, showCapture)) console.warn(`hotkey ${key} is taken`)
  } catch (e) {
    console.warn(`bad hotkey ${key}: ${e}`)
  }
}

function updateTray(): void {
  if (!tray) return
  const f = tracker.s.focus
  const p = tracker.s.paused
  const label = f
    ? `${f.itemId ? `#${f.itemId} ` : ''}${f.title} · ${fmtDur(Date.now() - f.startedAt)}`
    : p
      ? `Paused: ${p.focus.title}`
      : 'Nothing in focus'
  tray.setToolTip(`Golau: ${label}`)
  const quiet = (tracker.s.quietUntil ?? 0) > Date.now()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: label.length > 60 ? `${label.slice(0, 57)}…` : label, enabled: false },
      { type: 'separator' },
      { label: 'Open Golau', click: () => showMain() },
      ...(updater?.status.state === 'ready'
        ? [{ label: `Restart to update to ${updater.status.latest}`, click: () => installUpdateNow() }]
        : updater?.status.state === 'available'
          ? [{ label: `Golau ${updater.status.latest} is available…`, click: () => showMain({ view: 'settings' }) }]
          : []),
      { label: 'Quick capture…', accelerator: store.settings.captureHotkey, click: showCapture },
      { label: 'Switch task…', click: () => showMain({ view: 'pick' }) },
      f
        ? { label: 'Pause', click: () => tracker.pause('manual') }
        : p
          ? { label: 'Resume', click: () => tracker.resume() }
          : { label: 'Pause', enabled: false },
      { type: 'separator' },
      quiet
        ? { label: 'Turn nudges back on', click: () => tracker.setQuiet(undefined) }
        : {
            label: 'Quiet for…',
            submenu: [30, 60, 120, 240].map((m) => ({
              label: m < 60 ? `${m} min` : `${m / 60} h`,
              click: () => tracker.setQuiet(Date.now() + m * 60000)
            }))
          },
      { label: 'Show focus bar', type: 'checkbox', checked: store.settings.showMini, click: (i) => { store.saveSettings({ showMini: i.checked }); syncMini() } },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ])
  )
}

// ---------- nudge actions ----------

async function nudgeAction(id: string, action: string, payload: { text?: string; itemId?: number; ignored?: boolean }): Promise<void> {
  const n = currentNudge
  if (!n || n.id !== id) return
  hideNudge()
  if (payload.ignored) scheduler.ignored(n.kind)
  else scheduler.answered(n.kind)
  const t = tracker
  switch (n.kind) {
    case 'checkin':
      if (action === 'yes') t.confirm()
      if (action === 'switch') showMain({ view: 'pick' })
      if (action === 'break') t.pause('break')
      if (action === 'done' && t.s.focus?.itemId) showMain({ view: 'item', id: t.s.focus.itemId })
      if (action === 'dismiss') t.confirm()
      break
    case 'nofocus':
      if (action === 'pick') showMain({ view: 'pick' })
      if (action === 'unplanned') {
        if (payload.text?.trim()) t.startUnplanned(payload.text)
        else showMain({ view: 'pick' })
      }
      if (action === 'away') scheduler.snooze('nofocus', 90)
      break
    case 'unplanned-card': {
      const uid = n.data?.unplannedId as string
      if (action === 'link' && payload.itemId) {
        const item = await client().getItem(payload.itemId)
        t.resolveUnplanned(uid, 'linked', item)
        t.addWin({ itemId: item.id, title: item.title, kind: 'linked' })
      }
      if (action === 'create') showMain({ view: 'create', prefill: { title: n.data?.text as string }, fromUnplanned: uid })
      if (action === 'find') showMain({ view: 'pick' })
      if (action === 'kept') t.resolveUnplanned(uid, 'kept')
      if (action === 'later' || action === 'dismiss') {
        // ask once more later, then let it be
        const e = t.s.unplanned.find((x) => x.id === uid)
        if (e?.askedOnce) t.markUnplannedAsked(uid)
        else if (e) e.askedOnce = true
      } else t.markUnplannedAsked(uid)
      break
    }
    case 'hyperfocus':
      if (action === 'break') t.pause('break')
      break
    case 'welcome-back':
      if (action === 'resume') t.resume()
      if (action === 'switch') showMain({ view: 'pick' })
      if (action === 'stop') t.stop()
      break
    case 'morning':
      if (action === 'plan') showMain({ view: 'plan' })
      if (action === 'skip') t.setPlan({ itemIds: [], skipped: true })
      break
    case 'eod':
      if (action === 'start') showMain({ view: 'eod' })
      if (action === 'skip') t.setEod('skipped')
      break
    case 'stale':
      if (action === 'review') showMain({ view: 'stale' })
      break
  }
}

// ---------- API exposed to the renderer ----------

const api = {
  // settings & connection
  getSettings: () => store.settings,
  saveSettings: (patch: Partial<Settings>) => {
    const before = store.settings
    if (patch.orgUrl !== undefined) patch = { ...patch, orgUrl: checkOrgUrl(patch.orgUrl, DEV) }
    if (patch.busybar?.host && !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(patch.busybar.host))
      throw new Error('BUSY Bar address should be a host name or IP, like busybar.lan or 192.168.1.50')
    const s = store.saveSettings(patch)
    if (before.orgUrl !== s.orgUrl || before.project !== s.project || before.team !== s.team) resetClient()
    if (before.captureHotkey !== s.captureHotkey) registerHotkey()
    if (before.launchAtLogin !== s.launchAtLogin) applyLoginItem(s.launchAtLogin)
    syncMini()
    void busybar.update(tracker.s).catch(() => undefined)
    broadcast('settings', s)
    updateTray()
    return s
  },
  setPat: (pat: string) => {
    store.setSecret('pat', pat.trim() || undefined)
    resetClient()
    broadcast('settings', store.settings)
    return store.settings
  },
  setBusybarKey: (key: string) => {
    store.setSecret('busybarKey', key.trim() || undefined)
    broadcast('settings', store.settings)
    return store.settings
  },
  /** Validate org + PAT before saving. Uses the saved PAT when none is passed. */
  testConnection: async (orgUrl: string, pat?: string) => {
    const c = new AdoClient({ orgUrl, project: '', team: '', pat: pat || store.pat || '', allowLocal: DEV })
    const me = await c.getMe()
    const projects = await c.listProjects()
    return { me, projects }
  },
  listTeams: async (orgUrl: string, project: string, pat?: string) =>
    new AdoClient({ orgUrl, project, team: '', pat: pat || store.pat || '', allowLocal: DEV }).listTeams(project),
  connStatus: () => lastError,
  appVersion: () => app.getVersion(),
  startupWarnings: () => loadWarnings.splice(0),
  startupNotices: () => startupNotices.splice(0),
  appVersionInfo: () => ({ version: app.getVersion(), packaged: app.isPackaged, platform: process.platform }),
  updateStatus: () => updater.status,
  checkForUpdates: () => updater.check(),
  downloadUpdate: () => updater.download(),
  installUpdate: () => installUpdateNow(),
  me: () => guarded(() => client().getMe()),

  // work items
  myWork: (force?: boolean) => myWork(force),
  search: (q: SearchQuery) => guarded(() => client().search(q)),
  getItem: async (id: number) => {
    const item = await guarded(() => client().getDetails(id))
    touchCache(item)
    return item
  },
  getItems: (ids: number[]) => guarded(() => client().getItems(ids)),
  getComments: (id: number, project?: string) => guarded(() => client().getComments(id, project)),
  addComment: async (id: number, text: string, project?: string) => {
    await guarded(() => client().addComment(id, toHtml(text), project))
    tracker.addWin({ itemId: id, title: tracker.s.titles[id]?.title ?? `#${id}`, kind: 'commented' })
  },
  /** `fields.$parent`: a card id (or null) to make the card's parent, applied together with the other fields. */
  updateItem: async (id: number, fields: Record<string, unknown>): Promise<Mutation<WorkItem>> => {
    const { $parent, ...plain } = fields
    if ($parent !== undefined && $parent !== null) assertId($parent)
    const before = workCache.find((x) => x.id === id) ?? (await guarded(() => client().getItem(id)))
    try {
      const item = await guarded(async () => client().updateItem(id, await normalizeFields(before.type, before.project, plain), $parent as number | null | undefined))
      touchCache(item)
      if (typeof $parent === 'number') {
        const parent = await guarded(() => client().getItem($parent)).catch(() => undefined)
        if (parent) tracker.cacheTitle(parent.id, parent.title, parent.type, parent.state)
      }
      if (item.category === 'Completed' && before.category !== 'Completed') {
        tracker.addWin({ itemId: id, title: item.title, kind: 'closed' })
        if (tracker.s.focus?.itemId === id) tracker.stop()
      } else tracker.addWin({ itemId: id, title: item.title, kind: 'updated' })
      return { ok: true, value: item }
    } catch (e) {
      return asMutationError(e, before.type, before.project)
    }
  },
  typeLevels: (project?: string) => guarded(() => client().getTypeLevels(project)),
  typeFields: (type: string, project?: string) => guarded(() => client().typeFields(type, project)),
  assignToMe: async (id: number) => {
    const item = await guarded(() => client().assignToMe(id))
    touchCache(item)
    void myWork(true).catch(() => undefined)
    return item
  },
  createItem: async (input: CreateItemInput & { fromUnplanned?: string; fromInbox?: string }): Promise<Mutation<WorkItem>> => {
    let item: WorkItem
    try {
      const fields = input.fields ? await normalizeFields(input.type, undefined, input.fields) : undefined
      item = await guarded(() => client().createItem({ ...input, fields, description: input.description ? toHtml(input.description) : undefined }))
    } catch (e) {
      return asMutationError(e, input.type)
    }
    tracker.cacheTitle(item.id, item.title, item.type, item.state)
    tracker.addWin({ itemId: item.id, title: item.title, kind: 'created' })
    if (input.fromUnplanned) tracker.resolveUnplanned(input.fromUnplanned, 'created', item)
    if (input.fromInbox) tracker.resolveInbox(input.fromInbox, 'card', item.id)
    if (input.startFocus && !input.fromUnplanned) tracker.startItem(item)
    void myWork(true).catch(() => undefined)
    return { ok: true, value: item }
  },
  types: () => guarded(() => client().getTypes()),
  openExternal: (url: string) => openLink(url),
  /** open a work item in the browser by id (the focus bar only knows the id) */
  openInAdo: async (id: number) => {
    assertId(id)
    openLink(workCache.find((x) => x.id === id)?.webUrl ?? client().webUrl(id))
  },
  openBoard: () => openLink(client().boardUrl()),
  /** the team's ADO board columns, or undefined (no team / no access): the board view then uses state categories */
  board: () => guarded(() => client().getBoard()).catch(() => undefined),
  copyText: (text: string) => clipboard.writeText(String(text).slice(0, 10000)),

  // focus journal
  getState: () => tracker.s,
  focusItem: async (id: number) => {
    const known = workCache.find((x) => x.id === id) ?? (await guarded(() => client().getItem(id)))
    tracker.startItem(known)
    // Starting work on something still "New"? Offer the move in the UI; don't do it silently.
    return known
  },
  focusUnplanned: (text: string) => tracker.startUnplanned(text),
  resumeUnplanned: (id: string) => tracker.resumeUnplanned(id),
  pause: () => tracker.pause('manual'),
  takeBreak: () => tracker.pause('break'),
  resume: () => tracker.resume(),
  stopFocus: () => tracker.stop(),
  confirmFocus: () => tracker.confirm(),
  setNote: (itemId: number, text: string) => tracker.setNote(itemId, text),
  linkUnplanned: async (unplannedId: string, itemId: number) => {
    const item = await guarded(() => client().getItem(itemId))
    tracker.resolveUnplanned(unplannedId, 'linked', item)
    tracker.addWin({ itemId: item.id, title: item.title, kind: 'linked' })
  },
  resolveUnplanned: (id: string, kind: 'kept' | 'dismissed') => tracker.resolveUnplanned(id, kind),
  renameUnplanned: (id: string, text: string) => tracker.renameUnplanned(id, text),
  addInbox: (text: string) => tracker.addInbox(text),
  resolveInbox: (id: string, kind: 'card' | 'dismissed' | 'comment', itemId?: number) => tracker.resolveInbox(id, kind, itemId),
  restoreInbox: (id: string) => tracker.restoreInbox(id),
  setPlan: (itemIds: number[]) => {
    tracker.setPlan({ itemIds })
    scheduler.doneForToday('morning')
  },
  setEod: (v: 'done' | 'skipped') => {
    tracker.setEod(v)
    scheduler.doneForToday('eod')
  },
  setQuiet: (minutes: number | null) => tracker.setQuiet(minutes ? Date.now() + minutes * 60000 : undefined),

  // windows
  showMain: (route?: Route) => showMain(route),
  nudgeAction: (id: string, action: string, payload: { text?: string; itemId?: number; ignored?: boolean }) => nudgeAction(id, action, payload ?? {}),
  nudgeResize: (h: number) => {
    if (nudgeWin && !nudgeWin.isDestroyed()) placeNudge(nudgeWin, h)
  },
  testNudge: () =>
    showNudge({
      id: `test-${Date.now()}`,
      kind: 'test',
      title: 'This is what a nudge looks like',
      body: 'Small, in the corner, never steals your keyboard. Most go away on their own.',
      timeout: 20,
      actions: [{ id: 'ok', label: 'Got it', primary: true, onTimeout: true }]
    }),
  hideCapture: () => captureWin?.hide(),
  captureSubmit: (text: string, mode: 'inbox' | 'track') => {
    if (mode === 'track') tracker.startUnplanned(text)
    else tracker.addInbox(text)
    captureWin?.hide()
  },
  testBusybar: () => busybar.test(),
  clearBusybar: () => busybar.clear()
}

export type Api = typeof api

const API_METHODS = new Set(Object.keys(api))

ipcMain.handle('tl', async (e, method: unknown, ...args: unknown[]) => {
  // only our own page may call in, and only names that are really on the api object
  if (!e.senderFrame || !isAppUrl(e.senderFrame.url)) throw new Error('untrusted sender')
  if (typeof method !== 'string' || !API_METHODS.has(method)) throw new Error(`unknown api ${String(method)}`)
  const fn = api[method as keyof Api] as (...a: unknown[]) => unknown
  return fn(...args)
})

// ---------- lifecycle ----------

app.on('second-instance', () => showMain())

const SHOTS = devEnv('GOLAU_SHOTS')
if (SHOTS) {
  // never put anything on the real screen in screenshot mode
  for (const m of ['show', 'showInactive', 'focus'] as const) BrowserWindow.prototype[m] = function () {}
}

// Defense in depth for every webContents, including ones we didn't create on purpose.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault())
  wc.setWindowOpenHandler(({ url }) => {
    openLink(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  // the app needs no camera/mic/notifications/geolocation/etc. from the web layer
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  // The UI never needs the network: Azure DevOps and the BUSY Bar are called from this process.
  // So the web layer may load only the app's own files; everything else (remote images, tracking
  // pixels, \\host\share paths that would hand Windows credentials to a stranger) is cancelled.
  const appFiles = decodeURI(pathToFileURL(join(__dirname, '..')).href).toLowerCase()
  const devUrl = devEnv('ELECTRON_RENDERER_URL')
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url
    let ok = u.startsWith('data:') || u.startsWith('devtools:')
    if (!ok && u.startsWith('file:')) {
      try {
        ok = decodeURI(u).toLowerCase().startsWith(appFiles)
      } catch {
        ok = false
      }
    }
    if (!ok && devUrl) ok = u.startsWith(new URL(devUrl).origin) || /^wss?:\/\/localhost[:/]/.test(u)
    cb({ cancel: !ok })
  })
  if (!DEV) Menu.setApplicationMenu(null)

  store = new Store()
  if (store.settings.launchAtLogin && !DEV) applyLoginItem(true)
  if (migrated && process.platform === 'win32') {
    try {
      app.setLoginItemSettings({ openAtLogin: false, name: OLD_APP_ID })
    } catch {
      /* old entry may not exist */
    }
  }
  tracker = new Tracker(store)
  busybar = new BusyBar(() => ({ ...store.settings.busybar, key: store.busybarKey }))
  tracker.on('change', onStateChange)

  // Update checks use their own session: the default session blocks all network for the UI.
  const updateApi = devEnv('GOLAU_UPDATE_API')
  updater = new Updater({
    currentVersion: app.getVersion(),
    fetch: (url, init) => session.fromPartition('golau-updater').fetch(url, init),
    tempDir: app.getPath('temp'),
    canInstall: process.platform === 'win32' && app.isPackaged,
    releasesApi: updateApi
  })
  updater.on('status', (st) => {
    broadcast('update', st)
    updateTray()
    if (st.state === 'available' && store.settings.updates === 'auto') void updater.download()
  })
  if (!SHOTS && (app.isPackaged || updateApi)) {
    const scheduled = (): void => {
      if (store.settings.updates !== 'off') void updater.check()
    }
    setTimeout(scheduled, 30000)
    setInterval(scheduled, 6 * 3600000)
  }

  scheduler = new Scheduler({
    settings: () => store.settings,
    tracker,
    idleSeconds: () => (devEnv('GOLAU_FAKE_IDLE') ? Number(devEnv('GOLAU_FAKE_IDLE')) : powerMonitor.getSystemIdleTime()),
    myWork: () => workCache,
    isNudgeShowing: () => !!currentNudge,
    show: showNudge,
    suggestCards
  })
  if (!SHOTS) scheduler.start()

  // locking the screen / sleeping counts as walking away
  const away = (): void => {
    if (tracker.s.focus) tracker.pause('idle')
  }
  powerMonitor.on('lock-screen', away)
  powerMonitor.on('suspend', away)

  if (SHOTS) {
    void runShots(
      {
        store,
        tracker,
        showMain,
        main: () => mainWin,
        showNudge,
        nudge: () => nudgeWin,
        mini: () => miniWin,
        showCapture,
        capture: () => captureWin,
        suggestCards,
        refresh: () => myWork(true)
      },
      SHOTS
    ).catch((e) => {
      console.error('SHOTS FAILED:', e)
      app.exit(1)
    })
    return
  }

  try {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }))
    tray.on('click', () => showMain())
  } catch (e) {
    console.warn('no tray', e)
  }
  updateTray()
  registerHotkey()
  syncMini()

  // refresh my work every 5 min so stale checks and suggestions stay current
  setInterval(() => void myWork(true).catch(() => undefined), 5 * 60000)
  // tray label, BUSY Bar minutes
  setInterval(() => {
    updateTray()
    void busybar.update(tracker.s).catch(() => undefined)
    // heartbeat: lets a crash/reboot be cut off at the last minute we knew you were here
    if (tracker.s.focus) store.saveState()
  }, 60000)
  if (store.settings.hasPat) void myWork(true).catch(() => undefined)

  if (!process.argv.includes('--hidden')) showMain()

  ipcMain.on('nudge-ready', () => {
    if (currentNudge) nudgeWin?.webContents.send('nudge', currentNudge)
  })
})

app.on('window-all-closed', () => {
  // stay in the tray
})

// Windows restart/logoff doesn't always reach before-quit; save on the way down regardless.
powerMonitor.on('shutdown', () => store?.flush())
app.on('before-quit', () => {
  // "auto" mode: a downloaded update installs while the app is closed (no relaunch)
  if (updater && store?.settings.updates === 'auto' && updater.status.state === 'ready') updater.install(false)
  quitting = true
  store?.flush()
  void busybar?.clear()
  globalShortcut.unregisterAll()
})
