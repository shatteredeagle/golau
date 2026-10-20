import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { dayKey } from '../shared/time'
import type { AppState, DayPlan, FocusRef, UnplannedEntry, Win } from '../shared/types'
import type { Store } from './store'

/**
 * Owns the local journal: what you're focused on, time sessions, unplanned work, inbox, plans.
 * Every mutation saves and emits 'change'.
 */
export class Tracker extends EventEmitter {
  constructor(private store: Store) {
    super()
    // A crash or reboot can leave a session open; close it at the last save time.
    const open = this.s.sessions.filter((x) => x.end == null)
    if (open.length && !this.s.focus) open.forEach((x) => (x.end = x.start))
  }

  get s(): AppState {
    return this.store.state
  }

  private changed(): void {
    this.store.saveState()
    this.emit('change', this.s)
  }

  private endSession(at = Date.now()): void {
    for (const x of this.s.sessions) if (x.end == null) x.end = Math.max(x.start, at)
  }

  private begin(f: Omit<FocusRef, 'startedAt' | 'confirmedAt'>): void {
    this.endSession()
    const now = Date.now()
    this.s.focus = { ...f, startedAt: now, confirmedAt: now }
    this.s.paused = null
    this.s.sessions.push({ id: randomUUID(), itemId: f.itemId, unplannedId: f.unplannedId, start: now })
  }

  cacheTitle(id: number, title: string, type: string, state: string): void {
    this.s.titles[id] = { title, type, state }
  }

  startItem(item: { id: number; title: string; type: string; state?: string }): void {
    if (this.s.focus?.itemId === item.id) return
    this.cacheTitle(item.id, item.title, item.type, item.state ?? '')
    this.begin({ itemId: item.id, title: item.title, type: item.type })
    this.changed()
  }

  startUnplanned(text: string): UnplannedEntry {
    const entry: UnplannedEntry = { id: randomUUID(), text: text.trim() || 'Unplanned work', createdAt: Date.now() }
    this.s.unplanned.push(entry)
    this.begin({ unplannedId: entry.id, title: entry.text })
    this.changed()
    return entry
  }

  resumeUnplanned(id: string): void {
    const e = this.s.unplanned.find((x) => x.id === id)
    if (!e) return
    this.begin({ unplannedId: e.id, title: e.text })
    this.changed()
  }

  pause(reason: 'manual' | 'idle' | 'break', at = Date.now()): void {
    if (!this.s.focus) return
    this.endSession(at)
    this.s.paused = { focus: this.s.focus, reason, at }
    this.s.focus = null
    this.changed()
  }

  resume(): void {
    const p = this.s.paused
    if (!p) return
    this.begin({ itemId: p.focus.itemId, unplannedId: p.focus.unplannedId, title: p.focus.title, type: p.focus.type })
    this.changed()
  }

  stop(): void {
    this.endSession()
    this.s.focus = null
    this.s.paused = null
    this.changed()
  }

  confirm(): void {
    if (!this.s.focus) return
    this.s.focus.confirmedAt = Date.now()
    this.changed()
  }

  markHyperfocusAsked(): void {
    if (this.s.focus) this.s.focus.hyperfocusAsked = true
    this.changed()
  }

  markUnplannedAsked(id: string): void {
    const e = this.s.unplanned.find((x) => x.id === id)
    if (e) e.askedAboutCard = true
    this.changed()
  }

  /** Attach unplanned work to a card: its time moves to the card, and focus follows if it's running. */
  resolveUnplanned(id: string, kind: 'linked' | 'created' | 'kept' | 'dismissed', item?: { id: number; title: string; type: string }): void {
    const e = this.s.unplanned.find((x) => x.id === id)
    if (!e) return
    e.resolution = { kind, itemId: item?.id, at: Date.now() }
    if (item) {
      this.cacheTitle(item.id, item.title, item.type, '')
      for (const sess of this.s.sessions)
        if (sess.unplannedId === id) {
          sess.itemId = item.id
          delete sess.unplannedId
        }
      if (this.s.focus?.unplannedId === id) {
        this.s.focus = { ...this.s.focus, itemId: item.id, unplannedId: undefined, title: item.title, type: item.type }
      }
      if (this.s.paused?.focus.unplannedId === id) {
        this.s.paused.focus = { ...this.s.paused.focus, itemId: item.id, unplannedId: undefined, title: item.title, type: item.type }
      }
    }
    this.changed()
  }

  renameUnplanned(id: string, text: string): void {
    const e = this.s.unplanned.find((x) => x.id === id)
    if (!e) return
    e.text = text
    if (this.s.focus?.unplannedId === id) this.s.focus.title = text
    this.changed()
  }

  setNote(itemId: number, text: string): void {
    if (text.trim()) this.s.notes[itemId] = { text: text.trim(), at: Date.now() }
    else delete this.s.notes[itemId]
    this.changed()
  }

  addInbox(text: string): void {
    if (!text.trim()) return
    this.s.inbox.push({ id: randomUUID(), text: text.trim(), createdAt: Date.now() })
    this.changed()
  }

  resolveInbox(id: string, kind: 'card' | 'dismissed' | 'comment', itemId?: number): void {
    const e = this.s.inbox.find((x) => x.id === id)
    if (e) e.done = { kind, itemId, at: Date.now() }
    this.changed()
  }

  restoreInbox(id: string): void {
    const e = this.s.inbox.find((x) => x.id === id)
    if (e) delete e.done
    this.changed()
  }

  setPlan(plan: Omit<DayPlan, 'createdAt'>, day = dayKey()): void {
    this.s.plans[day] = { ...plan, createdAt: Date.now() }
    this.changed()
  }

  setEod(value: 'done' | 'skipped', day = dayKey()): void {
    this.s.eod[day] = value
    this.changed()
  }

  addWin(w: Omit<Win, 'at'>): void {
    this.s.wins.push({ ...w, at: Date.now() })
    this.changed()
  }

  setQuiet(until?: number): void {
    this.s.quietUntil = until
    this.changed()
  }
}
