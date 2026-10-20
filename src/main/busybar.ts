import type { AppState } from '../shared/types'
import { fmtDur } from '../shared/time'

/**
 * BUSY Bar front display (72x16) via its local HTTP API:
 *   POST   /api/display/draw   {application_name, priority, elements[]}
 *   DELETE /api/display/draw?application_name=golau
 * Auth: X-API-Token = the Bar's access PIN (only needed when one is set).
 * Our priority stays under Home Assistant's (50) so its "Meeting til" text wins.
 */
export interface BusyBarConfig {
  enabled: boolean
  host: string
  key?: string
  priority: number
}

const APP = 'golau'
const WHITE = '#FFFFFFFF'
const AMBER = '#FFB000FF'
const GREY = '#808080FF'
const TEAL = '#3DDCC8FF'

// Firmware can't render emoji / control chars.
const clean = (s: string): string =>
  s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()

export class BusyBar {
  private last = ''
  private getCfg: () => BusyBarConfig

  constructor(getCfg: () => BusyBarConfig) {
    this.getCfg = getCfg
  }

  private async call(method: 'POST' | 'DELETE', body?: unknown): Promise<void> {
    const cfg = this.getCfg()
    const host = cfg.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const url = `http://${host}/api/display/draw${method === 'DELETE' ? `?application_name=${APP}` : ''}`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { 'X-API-Token': cfg.key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) {
      const hint = res.status === 403 ? ' (wrong or missing access PIN)' : ''
      throw new Error(`BUSY Bar ${res.status}${hint}: ${(await res.text()).slice(0, 200)}`)
    }
  }

  private frame(line1: string, line2: string, color1: string, color2: string): unknown {
    return {
      application_name: APP,
      priority: Math.min(100, Math.max(1, this.getCfg().priority || 40)),
      elements: [
        { id: 'title', type: 'text', text: clean(line1) || ' ', font: 'small', color: color1, x: 0, y: 0, align: 'top_left', width: 72, scroll_rate: 30 },
        { id: 'status', type: 'text', text: clean(line2) || ' ', font: 'tiny', color: color2, x: 0, y: 10, align: 'top_left' }
      ]
    }
  }

  /** Redraw from app state; skips the call when nothing visible changed. */
  async update(state: AppState): Promise<void> {
    const cfg = this.getCfg()
    if (!cfg.enabled || !cfg.host) return
    let key: string
    let draw: unknown | null
    const f = state.focus
    if (f) {
      const mins = fmtDur(Date.now() - f.startedAt)
      const label = f.itemId ? `#${f.itemId} ${f.title}` : f.title
      const status = f.itemId ? `FOCUS ${mins}` : `UNPLANNED ${mins}`
      key = `${label}|${status}`
      draw = this.frame(label, status, WHITE, f.itemId ? TEAL : AMBER)
    } else if (state.paused) {
      const label = state.paused.focus.itemId ? `#${state.paused.focus.itemId} ${state.paused.focus.title}` : state.paused.focus.title
      const status = state.paused.reason === 'break' ? 'ON A BREAK' : 'PAUSED'
      key = `${label}|${status}`
      draw = this.frame(label, status, GREY, GREY)
    } else {
      key = 'clear'
      draw = null
    }
    if (key === this.last) return
    this.last = key
    try {
      if (draw) await this.call('POST', draw)
      else await this.call('DELETE')
    } catch (e) {
      this.last = '' // retry on next tick
      throw e
    }
  }

  async test(): Promise<void> {
    this.last = ''
    await this.call('POST', this.frame('Golau test: hello!', 'IT WORKS', WHITE, TEAL))
  }

  async clear(): Promise<void> {
    this.last = ''
    const cfg = this.getCfg()
    if (cfg.host) await this.call('DELETE').catch(() => undefined)
  }
}
