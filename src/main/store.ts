import { app, safeStorage } from 'electron'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'fs'
import { join } from 'path'
import type { AppState, Settings } from '../shared/types'
import { devEnv } from './env'

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
  const d = devEnv('GOLAU_DATA') ?? app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Problems found while loading, shown to the user once the window is up. */
export const loadWarnings: string[] = []

function readJson<T>(name: string, fallback: T): T {
  const p = join(dir(), name)
  let broken = false
  for (const candidate of [p, `${p}.bak`]) {
    if (!existsSync(candidate)) continue
    try {
      const data = { ...structuredClone(fallback), ...JSON.parse(readFileSync(candidate, 'utf8')) }
      if (broken) loadWarnings.push(`${name} was damaged; restored the previous copy.`)
      return data
    } catch {
      // keep the broken file for inspection and try the backup
      if (candidate === p) {
        broken = true
        renameSync(p, `${p}.broken-${Date.now()}`)
      }
    }
  }
  if (broken) loadWarnings.push(`${name} could not be read and had no usable backup; starting fresh.`)
  return structuredClone(fallback)
}

/** Write via temp file + fsync + rename, keeping the previous version as .bak. */
function writeFileAtomic(p: string, data: string | Buffer): void {
  const fd = openSync(`${p}.tmp`, 'w', 0o600)
  try {
    if (typeof data === 'string') writeSync(fd, data)
    else writeSync(fd, data, 0, data.length)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (existsSync(p)) copyFileSync(p, `${p}.bak`)
  renameSync(`${p}.tmp`, p)
}

function writeJson(name: string, data: unknown): void {
  writeFileAtomic(join(dir(), name), JSON.stringify(data, null, 2))
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
    if (!this.secureStorage)
      loadWarnings.push('This system has no secure key store, so your token is kept in memory only and you\'ll need to enter it again next launch.')
    this.prune()
  }

  /** DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux. Never plaintext on disk. */
  get secureStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    // Linux without a keyring falls back to a hard-coded key; treat that as not secure.
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : 'os'
    return backend !== 'basic_text' && backend !== 'unknown'
  }

  private loadSecrets(): Secrets {
    const p = join(dir(), 'secrets.bin')
    if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(p)))
    } catch {
      // encrypted for another Windows user/machine: ask for the token again
      loadWarnings.push('Your saved token could not be decrypted (different Windows user?). Please enter it again in Settings.')
      return {}
    }
  }

  private saveSecrets(): void {
    // Without OS encryption the secrets stay in memory for this session only.
    if (!this.secureStorage) return
    writeFileAtomic(join(dir(), 'secrets.bin'), safeStorage.encryptString(JSON.stringify(this.secrets)))
  }

  get pat(): string | undefined {
    return devEnv('GOLAU_PAT') ?? this.secrets.pat
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
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    clearTimeout(this.saveTimer)
    this.state.savedAt = Date.now()
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
