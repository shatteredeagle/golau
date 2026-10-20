import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { UpdateStatus } from '../shared/types'

/** Where releases come from. Only this repository's GitHub releases are ever considered. */
export const RELEASES_API = 'https://api.github.com/repos/shatteredeagle/golau/releases/latest'
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024
/** Download hosts GitHub uses for release assets (the API redirects there). */
const ALLOWED_HOSTS = /^(api\.github\.com|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com)$/i

/** "1.2.3" > "1.2.0"? Prerelease tags ("1.2.3-beta") are never offered. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(candidate)
  const b = parse(current.replace(/-.*$/, ''))
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** Find the expected hash for a file in a `sha256sum` style SHA256SUMS.txt. */
export function sumFor(sums: string, file: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2].trim() === file) return m[1].toLowerCase()
  }
  return undefined
}

export interface ReleaseInfo {
  version: string
  notes: string
  pageUrl: string
  installerName: string
  installerUrl: string
  installerSize: number
  sumsUrl: string
}

/** Pick the installer + checksum assets out of a GitHub "latest release" response. */
export function parseRelease(json: unknown): ReleaseInfo | null {
  const r = json as {
    tag_name?: string
    body?: string
    html_url?: string
    draft?: boolean
    prerelease?: boolean
    assets?: { name: string; browser_download_url: string; size: number }[]
  }
  if (!r?.tag_name || r.draft || r.prerelease) return null
  const version = r.tag_name.replace(/^v/, '')
  const installerName = `Golau-Setup-${version}.exe`
  const exe = r.assets?.find((a) => a.name === installerName)
  const sums = r.assets?.find((a) => a.name === 'SHA256SUMS.txt')
  if (!exe || !sums) return null
  return {
    version,
    notes: (r.body ?? '').slice(0, 4000),
    pageUrl: r.html_url ?? '',
    installerName,
    installerUrl: exe.browser_download_url,
    installerSize: exe.size,
    sumsUrl: sums.browser_download_url
  }
}

const checkUrl = (u: string): void => {
  const url = new URL(u)
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.test(url.hostname)) throw new Error(`refusing update URL ${url.hostname}`)
}

export interface UpdaterDeps {
  currentVersion: string
  /** fetch that uses the system network stack (proxy settings) and isn't blocked by the UI's network lock */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  tempDir: string
  canInstall: boolean
  releasesApi?: string
}

/**
 * Checks GitHub for a newer release, downloads the installer, verifies it against the release's
 * SHA256SUMS.txt, and hands over to the per-user installer (no admin) to upgrade in place.
 * Emits 'status' with an UpdateStatus whenever anything changes.
 */
export class Updater extends EventEmitter {
  status: UpdateStatus
  private release?: ReleaseInfo
  private file?: string
  private busy = false
  private d: UpdaterDeps

  constructor(d: UpdaterDeps) {
    super()
    this.d = d
    this.status = { state: 'idle', current: d.currentVersion }
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, current: this.d.currentVersion }
    this.emit('status', this.status)
  }

  async check(): Promise<UpdateStatus> {
    if (this.busy) return this.status
    if (this.status.state === 'ready' || this.status.state === 'downloading') return this.status
    this.busy = true
    this.set({ state: 'checking', error: undefined })
    try {
      const api = this.d.releasesApi ?? RELEASES_API
      checkUrl(api)
      const res = await this.d.fetch(api, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Golau-updater' }, signal: AbortSignal.timeout(15000) })
      if (res.status === 404) {
        this.set({ state: 'up-to-date', checkedAt: Date.now() })
        return this.status
      }
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      const rel = parseRelease(await res.json())
      if (rel && isNewer(rel.version, this.d.currentVersion)) {
        this.release = rel
        this.set({ state: 'available', latest: rel.version, notes: rel.notes, pageUrl: rel.pageUrl, checkedAt: Date.now() })
      } else {
        this.set({ state: 'up-to-date', latest: rel?.version, checkedAt: Date.now() })
      }
    } catch (e) {
      this.set({ state: 'error', error: `Couldn't check for updates: ${(e as Error).message}`, checkedAt: Date.now() })
    } finally {
      this.busy = false
    }
    return this.status
  }

  async download(): Promise<UpdateStatus> {
    const rel = this.release
    if (!rel || this.busy || this.status.state === 'ready') return this.status
    if (rel.installerSize > MAX_INSTALLER_BYTES) {
      this.set({ state: 'error', error: 'Update is unexpectedly large; not downloading it.' })
      return this.status
    }
    this.busy = true
    this.set({ state: 'downloading', progress: 0, error: undefined })
    const dir = join(this.d.tempDir, 'golau-update')
    const file = join(dir, rel.installerName)
    try {
      checkUrl(rel.sumsUrl)
      checkUrl(rel.installerUrl)
      const sumsRes = await this.d.fetch(rel.sumsUrl, { signal: AbortSignal.timeout(30000) })
      if (!sumsRes.ok) throw new Error(`checksums: HTTP ${sumsRes.status}`)
      checkUrl(sumsRes.url || rel.sumsUrl)
      const expected = sumFor(await sumsRes.text(), rel.installerName)
      if (!expected) throw new Error('the release has no checksum for the installer')

      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      const res = await this.d.fetch(rel.installerUrl, { signal: AbortSignal.timeout(15 * 60000) })
      if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`)
      checkUrl(res.url || rel.installerUrl)

      const hash = createHash('sha256')
      const out = createWriteStream(file, { mode: 0o600 })
      let got = 0
      let lastPct = -1
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        got += value.byteLength
        if (got > MAX_INSTALLER_BYTES) throw new Error('download larger than expected')
        hash.update(value)
        if (!out.write(value)) await new Promise((r) => out.once('drain', r))
        const pct = Math.floor((got / (rel.installerSize || got)) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          this.set({ progress: Math.min(100, pct) })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      const actual = hash.digest('hex')
      if (actual !== expected) throw new Error('checksum mismatch, the download was corrupted or altered')
      if (statSync(file).size !== got) throw new Error('incomplete download')
      this.file = file
      this.set({ state: 'ready', progress: 100 })
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      this.set({ state: 'error', error: `Update download failed: ${(e as Error).message}` })
    } finally {
      this.busy = false
    }
    return this.status
  }

  /**
   * Run the downloaded installer: silent, per-user, upgrade in place. `relaunch` reopens Golau
   * afterwards (Restart to update); without it the update just lands while the app is closed.
   * The caller quits the app right after this returns true.
   */
  install(relaunch: boolean): boolean {
    if (!this.d.canInstall || this.status.state !== 'ready' || !this.file || !existsSync(this.file)) return false
    const args = ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])]
    spawn(this.file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    this.set({ state: 'installing' })
    return true
  }
}
