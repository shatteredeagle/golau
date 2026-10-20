import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppState, Settings } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  orgUrl: '',
  project: '',
  team: '',
  hasPat: false,
  checkInMinutes: 45,
  noFocusMinutes: 15,
  unplannedAskMinutes: 20,
  staleDays: 3,
  hyperfocusMinutes: 90,
  idleMinutes: 10,
  workStart: '08:30',
  workEnd: '17:30',
  eodTime: '16:30',
  workDays: [1, 2, 3, 4, 5],
  nudgesEnabled: true,
  morningPlan: true,
  eodCheckIn: true,
  logCompletedWork: false,
  captureHotkey: 'CommandOrControl+Alt+Space',
  showMini: true,
  closeToTray: true,
  launchAtLogin: false,
  theme: 'system',
  busybar: { enabled: false, host: '', hasKey: false, priority: 40 }
}

const EMPTY_STATE: AppState = {
  focus: null,
  paused: null,
  sessions: [],
  unplanned: [],
  inbox: [],
  notes: {},
  plans: {},
  eod: {},
  wins: [],
  titles: {}
}

const dir = (): string => {
  const d = process.env.TASKLIGHT_DATA ?? app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function readJson<T>(name: string, fallback: T): T {
  const p = join(dir(), name)
  if (!existsSync(p)) return structuredClone(fallback)
  try {
    return { ...structuredClone(fallback), ...JSON.parse(readFileSync(p, 'utf8')) }
  } catch {
    // keep the broken file for inspection, start fresh
    renameSync(p, `${p}.broken-${Date.now()}`)
    return structuredClone(fallback)
  }
}

function writeJson(name: string, data: unknown): void {
  const p = join(dir(), name)
  writeFileSync(`${p}.tmp`, JSON.stringify(data, null, 2))
  renameSync(`${p}.tmp`, p)
}

type Secrets = { pat?: string; busybarKey?: string }

export class Store {
  settings: Settings
  state: AppState
  private secrets: Secrets
  private saveTimer?: NodeJS.Timeout

  constructor() {
    const s = readJson<Settings>('settings.json', DEFAULT_SETTINGS)
    s.busybar = { ...DEFAULT_SETTINGS.busybar, ...s.busybar }
    this.settings = s
    this.state = readJson<AppState>('state.json', EMPTY_STATE)
    this.secrets = this.loadSecrets()
    this.settings.hasPat = !!this.secrets.pat
    this.settings.busybar.hasKey = !!this.secrets.busybarKey
    this.prune()
  }

  private loadSecrets(): Secrets {
    const p = join(dir(), 'secrets.bin')
    if (!existsSync(p)) return {}
    try {
      const buf = readFileSync(p)
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
      return JSON.parse(json)
    } catch {
      return {}
    }
  }

  private saveSecrets(): void {
    const json = JSON.stringify(this.secrets)
    // DPAPI on Windows, keychain/libsecret elsewhere
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json)
    writeFileSync(join(dir(), 'secrets.bin'), data)
  }

  get pat(): string | undefined {
    return process.env.TASKLIGHT_PAT ?? this.secrets.pat
  }

  get busybarKey(): string | undefined {
    return this.secrets.busybarKey
  }

  setSecret(key: keyof Secrets, value: string | undefined): void {
    if (value) this.secrets[key] = value
    else delete this.secrets[key]
    this.saveSecrets()
    this.settings.hasPat = !!this.pat
    this.settings.busybar.hasKey = !!this.secrets.busybarKey
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const { hasPat: _a, ...rest } = patch
    this.settings = { ...this.settings, ...rest, hasPat: !!this.pat }
    if (patch.busybar) this.settings.busybar = { ...this.settings.busybar, ...patch.busybar, hasKey: !!this.busybarKey }
    writeJson('settings.json', this.settings)
    return this.settings
  }

  /** debounced write of state.json */
  saveState(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => writeJson('state.json', this.state), 300)
  }

  flush(): void {
    clearTimeout(this.saveTimer)
    writeJson('state.json', this.state)
  }

  /** drop history older than 60 days so the file stays small */
  private prune(): void {
    const cutoff = Date.now() - 60 * 864e5
    const s = this.state
    s.sessions = s.sessions.filter((x) => (x.end ?? Date.now()) > cutoff)
    s.wins = s.wins.filter((x) => x.at > cutoff)
    s.unplanned = s.unplanned.filter((x) => !x.resolution || x.resolution.at > cutoff)
    s.inbox = s.inbox.filter((x) => !x.done || x.done.at > cutoff)
    for (const k of Object.keys(s.plans)) if (new Date(k).getTime() < cutoff) delete s.plans[k]
    for (const k of Object.keys(s.eod)) if (new Date(k).getTime() < cutoff) delete s.eod[k]
  }
}
