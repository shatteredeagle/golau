import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { DEV, devEnv } from './env'

export type Surface = 'main' | 'nudge' | 'mini' | 'capture'

const preload = join(__dirname, '../preload/index.js')

const DEV_URL = devEnv('ELECTRON_RENDERER_URL')

/** The only page our windows ever show (and the only frames allowed to call the IPC API). */
export function isAppUrl(url: string): boolean {
  const page = url.split('#')[0]
  if (DEV_URL) return page.startsWith(DEV_URL)
  const want = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  try {
    return decodeURI(page).toLowerCase() === decodeURI(want).toLowerCase()
  } catch {
    return false
  }
}

/** Open a link from work item content in the real browser; anything but http(s) is dropped. */
export function openLink(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString())
  } catch {
    /* not a URL */
  }
}

function load(win: BrowserWindow, surface: Surface): void {
  if (DEV_URL) void win.loadURL(`${DEV_URL}#${surface}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: surface })
  // links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url)
    return { action: 'deny' }
  })
  // the app never navigates away from its one page (routing is in-page)
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    openLink(url)
  })
  win.webContents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
}

const common = {
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false,
    devTools: DEV,
    // dev screenshot mode renders without ever putting a window on screen
    offscreen: !!devEnv('TASKLIGHT_SHOTS')
  }
}

export function createMain(icon?: Electron.NativeImage): BrowserWindow {
  const win = new BrowserWindow({
    ...common,
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 580,
    title: 'Tasklight',
    backgroundColor: '#14161a',
    icon
  })
  load(win, 'main')
  win.once('ready-to-show', () => win.show())
  return win
}

/** Corner card for check-ins. Shown without stealing focus. */
export function createNudge(): BrowserWindow {
  const win = new BrowserWindow({
    ...common,
    width: 400,
    height: 220,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false
  })
  win.setAlwaysOnTop(true, 'floating')
  load(win, 'nudge')
  return win
}

export function placeNudge(win: BrowserWindow, height: number): void {
  const wa = screen.getPrimaryDisplay().workArea
  const w = 400
  const h = Math.min(Math.max(120, Math.round(height)), 560)
  win.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h })
}

/** Always-on-top pill showing the current focus + timer. */
export function createMini(pos?: { x: number; y: number }): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea
  const width = 440
  const height = 56
  let x = pos?.x ?? wa.x + Math.round((wa.width - width) / 2)
  let y = pos?.y ?? wa.y + 8
  // keep it on a screen that still exists
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return x >= b.x - 20 && y >= b.y - 20 && x < b.x + b.width - 40 && y < b.y + b.height - 20
  })
  if (!onScreen) {
    x = wa.x + Math.round((wa.width - width) / 2)
    y = wa.y + 8
  }
  const win = new BrowserWindow({
    ...common,
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    maximizable: false,
    minimizable: false
  })
  win.setAlwaysOnTop(true, 'floating')
  load(win, 'mini')
  return win
}

/** Quick capture box (global hotkey). */
export function createCapture(): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea
  const width = 600
  const win = new BrowserWindow({
    ...common,
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round(wa.height * 0.22),
    width,
    height: 150,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false
  })
  load(win, 'capture')
  win.on('blur', () => win.hide())
  return win
}
