export type StateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed'

export interface Person {
  name: string
  email?: string
  id?: string
}

export interface WorkItem {
  id: number
  rev: number
  title: string
  type: string
  state: string
  category: StateCategory
  assignedTo?: Person
  changedDate: string
  createdDate: string
  stateChangeDate?: string
  iterationPath?: string
  areaPath?: string
  project: string
  tags: string[]
  priority?: number
  remainingWork?: number
  completedWork?: number
  parentId?: number
  boardColumn?: string
  description?: string
  acceptanceCriteria?: string
  webUrl: string
}

export interface Comment {
  id: number
  text: string
  createdBy: string
  createdDate: string
}

export interface TypeInfo {
  name: string
  color: string
  states: { name: string; category: StateCategory; color: string }[]
}

export interface SearchQuery {
  text: string
  types?: string[]
  /** 'active' = not completed/removed */
  status?: 'any' | 'active' | 'done'
  assigned?: 'me' | 'anyone' | 'unassigned'
  allProjects?: boolean
  includeDescription?: boolean
}

export interface CreateItemInput {
  type: string
  title: string
  description?: string
  parentId?: number
  assignToMe: boolean
  currentIteration: boolean
  tags?: string[]
  remainingWork?: number
  startFocus?: boolean
  /** any other fields (reference name → value), e.g. ones the process marks required */
  fields?: Record<string, unknown>
}

export type FieldKind = 'string' | 'html' | 'plainText' | 'integer' | 'double' | 'dateTime' | 'boolean' | 'identity' | 'treePath' | 'other'

/** A field of a work item type, as the process defines it. */
export interface FieldSpec {
  referenceName: string
  name: string
  kind: FieldKind
  alwaysRequired: boolean
  readOnly: boolean
  defaultValue?: unknown
  allowedValues?: string[]
  helpText?: string
}

/** A rule Azure DevOps rejected, tied to a field when we can tell which. */
export interface FieldError {
  referenceName?: string
  name: string
  message: string
  /** empty-but-required (vs. an invalid value) */
  required: boolean
  field?: FieldSpec
}

export type UpdateMode = 'off' | 'notify' | 'auto'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'disabled'
  current: string
  latest?: string
  notes?: string
  pageUrl?: string
  progress?: number
  error?: string
  checkedAt?: number
}

/** Result of a create/update across IPC (Errors lose their extra properties there). */
export type Mutation<T> = { ok: true; value: T } | { ok: false; message: string; fieldErrors: FieldError[] }

export interface BusyBarSettings {
  enabled: boolean
  /** IP or hostname of the Bar */
  host: string
  /** the Bar's access PIN is stored encrypted, this only says whether one is saved */
  hasKey: boolean
  /** draw priority 1-100; keep below Home Assistant's (50) so meeting text wins */
  priority: number
}

export interface Settings {
  orgUrl: string
  project: string
  team: string
  hasPat: boolean
  /** minutes between "still on it?" check-ins */
  checkInMinutes: number
  /** minutes of activity with no focus before asking what you're on */
  noFocusMinutes: number
  /** an unplanned task running this long gets the "is there a card?" question */
  unplannedAskMinutes: number
  staleDays: number
  hyperfocusMinutes: number
  /** pause the timer after this much system idle time */
  idleMinutes: number
  workStart: string // HH:MM
  workEnd: string
  eodTime: string
  workDays: number[] // 0=Sun
  nudgesEnabled: boolean
  morningPlan: boolean
  eodCheckIn: boolean
  logCompletedWork: boolean
  captureHotkey: string
  showMini: boolean
  closeToTray: boolean
  launchAtLogin: boolean
  /** update checks: notify (default), auto-install on quit, or off */
  updates: UpdateMode
  miniPos?: { x: number; y: number }
  theme: 'system' | 'dark' | 'light'
  busybar: BusyBarSettings
}

export interface Session {
  id: string
  itemId?: number
  unplannedId?: string
  start: number
  end?: number
}

export interface UnplannedEntry {
  id: string
  text: string
  createdAt: number
  askedAboutCard?: boolean
  /** user said "ask later" once already */
  askedOnce?: boolean
  resolution?: { kind: 'linked' | 'created' | 'kept' | 'dismissed'; itemId?: number; at: number }
}

export interface InboxEntry {
  id: string
  text: string
  createdAt: number
  done?: { kind: 'card' | 'dismissed' | 'comment'; itemId?: number; at: number }
}

export interface FocusRef {
  itemId?: number
  unplannedId?: string
  title: string
  type?: string
  startedAt: number
  /** last time the user confirmed they're still on this */
  confirmedAt: number
  hyperfocusAsked?: boolean
}

export interface Paused {
  focus: FocusRef
  reason: 'manual' | 'idle' | 'break'
  at: number
}

export interface Win {
  at: number
  itemId?: number
  title: string
  kind: 'closed' | 'updated' | 'created' | 'commented' | 'linked'
}

export interface DayPlan {
  itemIds: number[]
  createdAt: number
  skipped?: boolean
}

export interface AppState {
  focus: FocusRef | null
  paused: Paused | null
  sessions: Session[]
  unplanned: UnplannedEntry[]
  inbox: InboxEntry[]
  /** per-item "where I left off" breadcrumb */
  notes: Record<number, { text: string; at: number }>
  plans: Record<string, DayPlan> // key YYYY-MM-DD
  eod: Record<string, 'done' | 'skipped'>
  wins: Win[]
  /** quiet mode: no nudges until this time */
  quietUntil?: number
  /** last time state.json was written; used to cut off sessions after a crash or reboot */
  savedAt?: number
  /** item cache so the UI has titles offline */
  titles: Record<number, { title: string; type: string; state: string }>
}

export type NudgeKind =
  | 'checkin'
  | 'nofocus'
  | 'unplanned-card'
  | 'hyperfocus'
  | 'welcome-back'
  | 'morning'
  | 'stale'
  | 'eod'
  | 'test'

export interface Nudge {
  id: string
  kind: NudgeKind
  title: string
  body?: string
  /** auto-dismiss after this many seconds; runs the action marked `onTimeout` */
  timeout?: number
  actions: { id: string; label: string; primary?: boolean; onTimeout?: boolean }[]
  /** card suggestions shown under the body (unplanned-card nudge) */
  suggestions?: { id: number; title: string; type: string }[]
  data?: Record<string, unknown>
}

/** navigation target for the main window, sent from main → renderer */
export type Route =
  | { view: 'today' | 'work' | 'search' | 'inbox' | 'settings' }
  | { view: 'plan' | 'eod' | 'stale' | 'pick' }
  | { view: 'item'; id: number }
  | {
      view: 'create'
      prefill?: Partial<CreateItemInput>
      fromUnplanned?: string
      fromInbox?: string
    }
