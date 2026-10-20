import type { AppState, Session } from './types'

export const pad = (n: number): string => String(n).padStart(2, '0')

export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfDay(ts: number = Date.now()): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "HH:MM" today as a timestamp */
export function atTime(hhmm: string, base: number = Date.now()): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

export function overlap(s: Session, from: number, to: number, now = Date.now()): number {
  const a = Math.max(s.start, from)
  const b = Math.min(s.end ?? now, to)
  return Math.max(0, b - a)
}

/** ms spent today, per work item id (unplanned keyed as "u:<id>") */
export function todayTotals(state: AppState, now = Date.now()): Map<string, number> {
  const from = startOfDay(now)
  const to = from + 864e5
  const out = new Map<string, number>()
  for (const s of state.sessions) {
    const ms = overlap(s, from, to, now)
    if (!ms) continue
    const key = s.itemId != null ? String(s.itemId) : `u:${s.unplannedId}`
    out.set(key, (out.get(key) ?? 0) + ms)
  }
  return out
}

export function itemTotal(state: AppState, itemId: number, now = Date.now()): number {
  return state.sessions.filter((s) => s.itemId === itemId).reduce((a, s) => a + overlap(s, 0, Infinity, now), 0)
}

export function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

export function daysSince(iso?: string, now = Date.now()): number {
  if (!iso) return 0
  return Math.floor((now - new Date(iso).getTime()) / 864e5)
}

export function ago(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}
