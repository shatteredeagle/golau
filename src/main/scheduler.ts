import { randomUUID } from 'crypto'
import { atTime, dayKey, daysSince, fmtDur } from '../shared/time'
import type { Nudge, NudgeKind, Settings, WorkItem } from '../shared/types'
import type { Tracker } from './tracker'
import { staleItems } from '../shared/stale'

export interface SchedulerDeps {
  settings: () => Settings
  tracker: Tracker
  /** seconds since last keyboard/mouse input */
  idleSeconds: () => number
  myWork: () => WorkItem[]
  isNudgeShowing: () => boolean
  show: (n: Nudge) => void
  suggestCards: (text: string) => Promise<{ id: number; title: string; type: string }[]>
}

/**
 * Decides when to nudge. Rules of thumb:
 * - one nudge on screen at a time, never while you're idle or outside work hours
 * - every nudge has a no-guilt "later" and most auto-dismiss to the gentle default
 * - each kind backs off after it's shown, so ignoring it doesn't cause a pile-up
 */
export class Scheduler {
  private snoozed = new Map<NudgeKind, number>()
  private askedDay = new Map<NudgeKind, string>()
  private noFocusSince?: number
  private timer?: NodeJS.Timeout
  private d: SchedulerDeps

  constructor(d: SchedulerDeps) {
    this.d = d
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 20000)
    setTimeout(() => void this.tick(), 4000)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  /** clock of the tick being evaluated (tests drive it; live it's Date.now()) */
  private clock?: number
  private get now(): number {
    return this.clock ?? Date.now()
  }

  snooze(kind: NudgeKind, minutes: number): void {
    this.snoozed.set(kind, this.now + minutes * 60000)
  }

  doneForToday(kind: NudgeKind): void {
    this.askedDay.set(kind, dayKey(this.now))
  }

  private ready(kind: NudgeKind, now: number): boolean {
    if ((this.snoozed.get(kind) ?? 0) > now) return false
    return this.askedDay.get(kind) !== dayKey(now)
  }

  inWorkHours(now = Date.now(), s = this.d.settings()): boolean {
    const day = new Date(now).getDay()
    return s.workDays.includes(day) && now >= atTime(s.workStart, now) && now < atTime(s.workEnd, now)
  }

  private shownToday = new Map<string, number>()

  private show(kind: NudgeKind, n: Omit<Nudge, 'id' | 'kind'>, backoffMin: number): void {
    this.snooze(kind, backoffMin)
    // Morning/EOD asks give up after 3 tries a day; ignoring them is an answer too.
    const k = `${kind}:${dayKey(this.now)}`
    const count = (this.shownToday.get(k) ?? 0) + 1
    this.shownToday.set(k, count)
    if ((kind === 'morning' || kind === 'eod') && count >= 3) this.doneForToday(kind)
    this.d.show({ id: randomUUID(), kind, ...n })
  }

  async tick(now = Date.now()): Promise<void> {
    this.clock = now
    try {
      await this.evaluate(now)
    } finally {
      this.clock = undefined
    }
  }

  private async evaluate(now: number): Promise<void> {
    const s = this.d.settings()
    const t = this.d.tracker
    const st = t.s
    const idle = this.d.idleSeconds()

    // Idle → pause the clock at the moment you walked away (runs even with nudges off).
    if (st.focus && idle >= s.idleMinutes * 60) {
      t.pause('idle', now - idle * 1000)
      return
    }

    if (idle > 90) {
      this.noFocusSince = undefined
      return
    }
    if (!st.focus) this.noFocusSince ??= now
    else this.noFocusSince = undefined

    if (!s.nudgesEnabled || (st.quietUntil ?? 0) > now || this.d.isNudgeShowing()) return
    if (!s.orgUrl || !s.hasPat) return

    const today = dayKey(now)
    const f = st.focus
    const p = st.paused

    // Back from being away, or a break ran its course.
    if (!f && p && (p.reason === 'idle' || (p.reason === 'break' && now - p.at >= 5 * 60000)) && this.ready('welcome-back', now)) {
      const label = p.focus.itemId ? `#${p.focus.itemId} ${p.focus.title}` : p.focus.title
      const away = fmtDur(now - p.at)
      const note = p.focus.itemId ? st.notes[p.focus.itemId]?.text : undefined
      return this.show(
        'welcome-back',
        {
          title: p.reason === 'break' ? 'Break done?' : 'Welcome back',
          body: `You were on ${label} (away ${away}).${note ? `\nYou left off: ${note}` : ''}`,
          actions: [
            { id: 'resume', label: 'Pick it back up', primary: true },
            { id: 'switch', label: 'Something else' },
            { id: 'stop', label: 'Not working' }
          ]
        },
        10
      )
    }

    if (!this.inWorkHours(now, s)) return

    // Morning plan: once, the first time you're active in work hours.
    if (s.morningPlan && !st.plans[today] && this.ready('morning', now)) {
      const n = this.d.myWork().filter((i) => i.category === 'InProgress').length
      return this.show(
        'morning',
        {
          title: 'Morning! Plan the day?',
          body: n ? `${n} card${n > 1 ? 's' : ''} in progress. Pick what matters today, takes ~2 min.` : 'Pick what matters today, takes ~2 min.',
          actions: [
            { id: 'plan', label: 'Plan my day', primary: true },
            { id: 'later', label: 'In 30 min' },
            { id: 'skip', label: 'Skip today' }
          ]
        },
        30
      )
    }

    // End-of-day wrap up.
    if (s.eodCheckIn && !st.eod[today] && now >= atTime(s.eodTime, now) && this.ready('eod', now)) {
      return this.show(
        'eod',
        {
          title: 'Wrap up the day?',
          body: 'Quick pass over what you touched today so your cards match reality. ~3 min.',
          actions: [
            { id: 'start', label: 'Wrap up', primary: true },
            { id: 'later', label: '15 min' },
            { id: 'skip', label: 'Skip today' }
          ]
        },
        15
      )
    }

    if (f) {
      const on = now - f.startedAt
      // Long unbroken stretch: suggest a breather, once per stretch.
      if (!f.hyperfocusAsked && on >= s.hyperfocusMinutes * 60000) {
        t.markHyperfocusAsked()
        return this.show(
          'hyperfocus',
          {
            title: `${fmtDur(on)} straight. Nice.`,
            body: 'Stand up, water, stretch? The timer pauses and I\'ll check back in 5.',
            timeout: 60,
            actions: [
              { id: 'break', label: 'Take 5', primary: true },
              { id: 'keep', label: 'Keep going', onTimeout: true }
            ]
          },
          s.hyperfocusMinutes
        )
      }

      // Unplanned work: is there a card for this?
      if (f.unplannedId) {
        const e = st.unplanned.find((x) => x.id === f.unplannedId)
        if (e && !e.askedAboutCard && !e.resolution && on >= s.unplannedAskMinutes * 60000 && this.ready('unplanned-card', now)) {
          const suggestions = await this.d.suggestCards(e.text).catch(() => [])
          return this.show(
            'unplanned-card',
            {
              title: 'Is there a card for this?',
              body: `"${e.text}" has been going ${fmtDur(on)}.`,
              suggestions,
              data: { unplannedId: e.id, text: e.text },
              actions: [
                { id: 'create', label: 'Make a card', primary: true },
                { id: 'find', label: 'Find one…' },
                { id: 'kept', label: 'No card needed' },
                { id: 'later', label: 'Ask later' }
              ]
            },
            30
          )
        }
      }

      // Regular check-in.
      if (now - f.confirmedAt >= s.checkInMinutes * 60000 && this.ready('checkin', now)) {
        const label = f.itemId ? `#${f.itemId} ${f.title}` : f.title
        return this.show(
          'checkin',
          {
            title: 'Still on this?',
            body: `${label}\n${fmtDur(on)} so far`,
            timeout: 90,
            data: { itemId: f.itemId },
            actions: [
              { id: 'yes', label: 'Yep', primary: true, onTimeout: true },
              { id: 'switch', label: 'Switched' },
              { id: 'break', label: 'Break' },
              ...(f.itemId ? [{ id: 'done', label: 'Finished it' }] : [])
            ]
          },
          5
        )
      }
      return
    }

    // Active at the keyboard with nothing in focus.
    if (this.noFocusSince && now - this.noFocusSince >= s.noFocusMinutes * 60000 && this.ready('nofocus', now)) {
      const plan = st.plans[today]?.itemIds ?? []
      return this.show(
        'nofocus',
        {
          title: 'What are you working on?',
          body: p?.reason === 'manual' ? `Paused: ${p.focus.title}` : plan.length ? `${plan.length} card${plan.length > 1 ? 's' : ''} on today's plan.` : undefined,
          timeout: 120,
          data: { input: true },
          actions: [
            { id: 'pick', label: 'Pick a card', primary: true },
            { id: 'unplanned', label: 'Track it' },
            { id: 'away', label: 'Not working', onTimeout: false },
            { id: 'later', label: 'Later', onTimeout: true }
          ]
        },
        s.noFocusMinutes
      )
    }

    // Stale cards: at most once a day, after lunch-ish.
    if (now >= atTime('11:00', now) && this.ready('stale', now)) {
      const stale = staleItems(this.d.myWork(), s.staleDays, now)
      if (stale.length) {
        this.doneForToday('stale')
        return this.show(
          'stale',
          {
            title: `${stale.length} card${stale.length > 1 ? 's' : ''} gone quiet`,
            body: stale
              .slice(0, 3)
              .map((i) => `#${i.id} ${i.title} · ${daysSince(i.changedDate, now)}d`)
              .join('\n'),
            timeout: 45,
            actions: [
              { id: 'review', label: 'Quick review', primary: true },
              { id: 'later', label: 'Not today', onTimeout: true }
            ]
          },
          60 * 24
        )
      }
    }
  }
}
