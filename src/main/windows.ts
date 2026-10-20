import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'

export type Surface = 'main' | 'nudge' | 'mini' | 'capture'

const preload = join(__dirname, '../preload/index.js')

function load(win: BrowserWindow, surface: Surface): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${surface}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: surface })
  // links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\0')) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
}

const common = {
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    preload,
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    // dev screenshot mode renders without ever putting a window on screen
    offscreen: !!process.env.TASKLIGHT_SHOTS
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
