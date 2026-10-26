import type {
  BoardInfo,
  Comment,
  CreateItemInput,
  FieldError,
  FieldKind,
  FieldSpec,
  Person,
  SearchQuery,
  StateCategory,
  TypeInfo,
  WorkItem
} from '../shared/types'
import { isTimeEstimate } from '../shared/fields'
import { levelsFromCategories, parentLink, parentPatch, type Relation, type TypeLevels } from '../shared/parent'

const API = 'api-version=7.1'
const COMMENTS_API = 'api-version=7.1-preview.4'

const CORE_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  'System.ChangedDate',
  'System.CreatedDate',
  'System.IterationPath',
  'System.AreaPath',
  'System.TeamProject',
  'System.Tags',
  'System.Parent',
  'System.BoardColumn'
]
// Not every process template has these; batch requests fall back to CORE_FIELDS if ADO rejects them.
const EXTRA_FIELDS = [
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.StateChangeDate',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  'Microsoft.VSTS.Scheduling.CompletedWork'
]

export class AdoError extends Error {
  status: number
  /** parsed JSON error body from Azure DevOps, when there was one */
  body?: unknown
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/**
 * Turn an Azure DevOps rule failure into per-field errors. ADO reports them either as
 * customProperties.RuleValidationErrors[] or only in the message:
 *   "TF401320: Rule Error for field Description. Error code: Required, InvalidEmpty."
 */
export function parseRuleErrors(message: string, body?: unknown): FieldError[] {
  const b = body as { customProperties?: { RuleValidationErrors?: unknown } } | undefined
  const list = b?.customProperties?.RuleValidationErrors
  // "InvalidEmpty" = required and blank; "Required" alone (no invalid-value flag) means the same
  const isRequired = (flags: string): boolean =>
    /invalidEmpty/i.test(flags) || (/required/i.test(flags) && !/invalid(ListValue|Value|Format|Type)/i.test(flags))
  if (Array.isArray(list) && list.length) {
    return list.map((e: { fieldReferenceName?: string; fieldStatusFlags?: string; errorMessage?: string }) => {
      const flags = e.fieldStatusFlags ?? ''
      const named = /Rule Error for field ([^.]+)\./.exec(e.errorMessage ?? '')
      return {
        referenceName: e.fieldReferenceName,
        name: named?.[1].trim() ?? e.fieldReferenceName ?? 'field',
        message: e.errorMessage ?? message,
        required: isRequired(flags) || /required|cannot be empty/i.test(e.errorMessage ?? '')
      }
    })
  }
  const out: FieldError[] = []
  const re = /Rule Error for field ([^.]+)\.\s*Error code:\s*([^.]+)\./g
  for (let m = re.exec(message); m; m = re.exec(message)) {
    out.push({ name: m[1].trim(), message: `${m[1].trim()}: ${m[2].trim()}`, required: isRequired(m[2]) })
  }
  return out
}

const KIND: Record<string, FieldKind> = {
  string: 'string', picklistString: 'string', html: 'html', plainText: 'plainText',
  integer: 'integer', picklistInteger: 'integer', double: 'double', picklistDouble: 'double',
  dateTime: 'dateTime', boolean: 'boolean', identity: 'identity', treePath: 'treePath'
}

export interface AdoConfig {
  orgUrl: string
  project: string
  team: string
  pat: string
  /** dev only: allow http://localhost (the mock server) */
  allowLocal?: boolean
}

/**
 * The PAT is only ever sent to Azure DevOps. Returns the normalized org URL or throws.
 * Accepts https://dev.azure.com/<org> and https://<org>.visualstudio.com.
 */
export function checkOrgUrl(raw: string, allowLocal = false): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new AdoError('That doesn\'t look like a URL. Use https://dev.azure.com/<your-org>', 0)
  }
  const host = u.hostname.toLowerCase()
  const azure =
    u.protocol === 'https:' && !u.port && (host === 'dev.azure.com' || /^[a-z0-9][a-z0-9-]*\.visualstudio\.com$/.test(host))
  const local = allowLocal && u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')
  if (!azure && !local) throw new AdoError('Organization URL must be https://dev.azure.com/<org> or https://<org>.visualstudio.com', 0)
  if (u.username || u.password || u.search || u.hash) throw new AdoError('Organization URL can\'t contain credentials or query strings', 0)
  const parts = u.pathname.split('/').filter(Boolean)
  // dev.azure.com needs the org segment; keep only that (a pasted board URL works too)
  if (host === 'dev.azure.com') {
    if (!parts[0]) throw new AdoError('Add your organization: https://dev.azure.com/<org>', 0)
    return `https://dev.azure.com/${parts[0]}`
  }
  return local ? `${u.origin}/${parts[0] ?? ''}`.replace(/\/$/, '') : u.origin
}

const wiqlString = (s: string): string => `'${String(s).replace(/'/g, "''")}'`

/** IPC inputs come from the renderer; never let them shape URLs or patch paths freely. */
export function assertId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new AdoError(`Bad work item id: ${String(id)}`, 0)
  return id
}
const assertField = (name: string): string => {
  if (!/^[A-Za-z][\w.]*$/.test(name)) throw new AdoError(`Bad field name: ${name}`, 0)
  return name
}

export class AdoClient {
  private me?: Person
  private types = new Map<string, TypeInfo[]>() // by project
  private levels = new Map<string, TypeLevels>() // by project
  private fieldKinds = new Map<string, Map<string, { kind: FieldKind; readOnly: boolean; name: string }>>() // by project
  private typeFieldCache = new Map<string, FieldSpec[]>() // project|type
  private extraFieldsOk = true
  private timeEstimateRefs = new Map<string, string | undefined>() // by project
  private boardCache?: { at: number; value: BoardInfo | undefined }
  private cfg: AdoConfig

  constructor(cfg: AdoConfig) {
    this.cfg = { ...cfg, orgUrl: checkOrgUrl(cfg.orgUrl, cfg.allowLocal) }
  }

  get org(): string {
    return this.cfg.orgUrl.replace(/\/+$/, '')
  }

  private projectUrl(project = this.cfg.project): string {
    return `${this.org}/${encodeURIComponent(project)}`
  }

  private async req<T>(url: string, init: RequestInit = {}): Promise<T> {
    const auth = Buffer.from(`:${this.cfg.pat}`).toString('base64')
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(20000),
      // never follow redirects with the token attached (ADO redirects bad tokens to a sign-in page)
      redirect: 'manual'
    })
    if (res.status >= 300 && res.status < 400) {
      throw new AdoError('Azure DevOps rejected the token (expired or wrong scope?)', 401)
    }
    const text = await res.text()
    // A bad/expired PAT gets a 203 + sign-in HTML page instead of a 401.
    if (res.status === 203 || (res.ok && text.trimStart().startsWith('<'))) {
      throw new AdoError('Azure DevOps rejected the token (expired or wrong scope?)', 401)
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      let body: unknown
      try {
        body = JSON.parse(text)
        msg = (body as { message?: string }).message ?? msg
      } catch {
        /* keep status text */
      }
      if (res.status === 401) msg = 'Azure DevOps rejected the token (expired or wrong scope?)'
      throw new AdoError(msg, res.status, body)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  webUrl(id: number, project = this.cfg.project): string {
    return `${this.projectUrl(project)}/_workitems/edit/${id}`
  }

  /** The team's board in the browser, or the project's boards when no team is picked. */
  boardUrl(): string {
    return this.cfg.team
      ? `${this.projectUrl()}/_boards/board/t/${encodeURIComponent(this.cfg.team)}`
      : `${this.projectUrl()}/_boards/board`
  }

  /**
   * The team's backlog-items board: the requirement backlog level (Stories / Backlog items / Issues),
   * its columns in order and which state each type has in each column. Undefined without a team.
   */
  async getBoard(): Promise<BoardInfo | undefined> {
    if (!this.cfg.team) return undefined
    if (this.boardCache && Date.now() - this.boardCache.at < 5 * 60e3) return this.boardCache.value
    const team = `${this.projectUrl()}/${encodeURIComponent(this.cfg.team)}`
    const levels = await this.req<{ value: { id: string; name: string; type?: string }[] }>(`${team}/_apis/work/backlogs?${API}`)
    const level = levels.value.find((l) => l.type === 'requirement') ?? levels.value.find((l) => l.id === 'Microsoft.RequirementCategory')
    let value: BoardInfo | undefined
    if (level) {
      const b = await this.req<{
        name: string
        columns?: { name: string; columnType: BoardInfo['columns'][number]['columnType']; stateMappings?: Record<string, string> }[]
        fields?: { columnField?: { referenceName?: string } }
      }>(`${team}/_apis/work/boards/${encodeURIComponent(level.name)}?${API}`)
      if (b.columns?.length)
        value = {
          name: b.name,
          columnField: b.fields?.columnField?.referenceName,
          columns: b.columns.map((c) => ({ name: c.name, columnType: c.columnType, stateMappings: c.stateMappings ?? {} }))
        }
    }
    this.boardCache = { at: Date.now(), value }
    return value
  }

  async getMe(): Promise<Person> {
    if (this.me) return this.me
    const data = await this.req<{
      authenticatedUser: { id: string; providerDisplayName: string; properties?: Record<string, { $value: string }> }
    }>(`${this.org}/_apis/connectionData`)
    const u = data.authenticatedUser
    this.me = { id: u.id, name: u.providerDisplayName, email: u.properties?.Account?.$value }
    return this.me
  }

  async listProjects(): Promise<string[]> {
    const data = await this.req<{ value: { name: string }[] }>(`${this.org}/_apis/projects?$top=500&${API}`)
    return data.value.map((p) => p.name).sort((a, b) => a.localeCompare(b))
  }

  async listTeams(project: string): Promise<string[]> {
    const data = await this.req<{ value: { name: string }[] }>(
      `${this.org}/_apis/projects/${encodeURIComponent(project)}/teams?$top=500&${API}`
    )
    return data.value.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  }

  async getTypes(project = this.cfg.project): Promise<TypeInfo[]> {
    const cached = this.types.get(project)
    if (cached) return cached
    const data = await this.req<{ value: { name: string; color: string; isDisabled?: boolean; states?: { name: string; color: string; category: StateCategory }[] }[] }>(
      `${this.projectUrl(project)}/_apis/wit/workitemtypes?${API}`
    )
    const hidden = new Set([
      'Code Review Request', 'Code Review Response', 'Feedback Request', 'Feedback Response',
      'Shared Steps', 'Shared Parameter', 'Test Case', 'Test Plan', 'Test Suite'
    ])
    const types: TypeInfo[] = data.value
      .filter((t) => !t.isDisabled && !hidden.has(t.name))
      .map((t) => ({
        name: t.name,
        color: `#${(t.color ?? '888888').slice(-6)}`,
        states: (t.states ?? []).map((s) => ({ ...s, color: `#${(s.color ?? '888888').slice(-6)}` }))
      }))
    // Older API responses omit states; fetch them per type.
    await Promise.all(
      types
        .filter((t) => t.states.length === 0)
        .map(async (t) => {
          const s = await this.req<{ value: { name: string; color: string; category: StateCategory }[] }>(
            `${this.projectUrl(project)}/_apis/wit/workitemtypes/${encodeURIComponent(t.name)}/states?${API}`
          )
          t.states = s.value.map((x) => ({ ...x, color: `#${(x.color ?? '888888').slice(-6)}` }))
        })
    )
    this.types.set(project, types)
    return types
  }

  private async closedStates(project?: string): Promise<{ done: string[]; removed: string[] }> {
    const types = await this.getTypes(project)
    const done = new Set<string>()
    const removed = new Set<string>()
    for (const t of types)
      for (const s of t.states) {
        if (s.category === 'Completed') done.add(s.name)
        if (s.category === 'Removed') removed.add(s.name)
      }
    if (done.size === 0) ['Done', 'Closed'].forEach((s) => done.add(s))
    if (removed.size === 0) removed.add('Removed')
    return { done: [...done], removed: [...removed] }
  }

  private categoryOf(types: TypeInfo[], type: string, state: string): StateCategory {
    const s = types.find((t) => t.name === type)?.states.find((x) => x.name === state)
    if (s) return s.category
    if (/done|closed/i.test(state)) return 'Completed'
    if (/removed|cut/i.test(state)) return 'Removed'
    if (/resolved/i.test(state)) return 'Resolved'
    if (/new|proposed|to ?do|approved/i.test(state)) return 'Proposed'
    return 'InProgress'
  }

  private async wiql(query: string, top = 200, project?: string | null): Promise<number[]> {
    // project === null → org-wide (no @project macro allowed)
    const base =
      project === null
        ? this.org
        : this.cfg.team && !project
          ? `${this.projectUrl()}/${encodeURIComponent(this.cfg.team)}`
          : this.projectUrl(project ?? this.cfg.project)
    const data = await this.req<{ workItems: { id: number }[] }>(`${base}/_apis/wit/wiql?$top=${top}&${API}`, {
      method: 'POST',
      body: JSON.stringify({ query })
    })
    return data.workItems.map((w) => w.id)
  }

  private toPerson(v: unknown): Person | undefined {
    if (!v || typeof v !== 'object') return undefined
    const o = v as { displayName?: string; uniqueName?: string; id?: string }
    return { name: o.displayName ?? o.uniqueName ?? '?', email: o.uniqueName, id: o.id }
  }

  private async mapItems(raw: { id: number; rev: number; fields: Record<string, unknown> }[]): Promise<WorkItem[]> {
    const projects = [...new Set(raw.map((r) => r.fields['System.TeamProject'] as string))]
    const typesBy = new Map<string, TypeInfo[]>()
    const estimateRef = new Map<string, string | undefined>()
    await Promise.all(
      projects.map(async (p) => {
        typesBy.set(p, await this.getTypes(p).catch(() => []))
        estimateRef.set(p, await this.timeEstimateRef(p))
      })
    )
    return raw.map((r) => {
      const f = r.fields
      const project = f['System.TeamProject'] as string
      const type = f['System.WorkItemType'] as string
      const state = f['System.State'] as string
      return {
        id: r.id,
        rev: r.rev,
        title: f['System.Title'] as string,
        type,
        state,
        category: this.categoryOf(typesBy.get(project) ?? [], type, state),
        assignedTo: this.toPerson(f['System.AssignedTo']),
        changedDate: f['System.ChangedDate'] as string,
        createdDate: f['System.CreatedDate'] as string,
        stateChangeDate: f['Microsoft.VSTS.Common.StateChangeDate'] as string | undefined,
        iterationPath: f['System.IterationPath'] as string | undefined,
        areaPath: f['System.AreaPath'] as string | undefined,
        project,
        tags: ((f['System.Tags'] as string | undefined) ?? '')
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean),
        priority: f['Microsoft.VSTS.Common.Priority'] as number | undefined,
        remainingWork: f['Microsoft.VSTS.Scheduling.RemainingWork'] as number | undefined,
        completedWork: f['Microsoft.VSTS.Scheduling.CompletedWork'] as number | undefined,
        timeEstimate: f[estimateRef.get(project) ?? ''],
        parentId: f['System.Parent'] as number | undefined,
        boardColumn: f['System.BoardColumn'] as string | undefined,
        description: f['System.Description'] as string | undefined,
        acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined,
        webUrl: this.webUrl(r.id, project)
      }
    })
  }

  async getItems(ids: number[]): Promise<WorkItem[]> {
    ids.forEach(assertId)
    if (ids.length === 0) return []
    const out: { id: number; rev: number; fields: Record<string, unknown> }[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const fetchChunk = (fields: string[]) =>
        this.req<{ value: { id: number; rev: number; fields: Record<string, unknown> }[] }>(
          `${this.org}/_apis/wit/workitemsbatch?${API}`,
          { method: 'POST', body: JSON.stringify({ ids: chunk, fields, errorPolicy: 'omit' }) }
        )
      let data
      try {
        data = await fetchChunk(this.extraFieldsOk ? [...CORE_FIELDS, ...EXTRA_FIELDS] : CORE_FIELDS)
      } catch (e) {
        if (!(e instanceof AdoError) || e.status !== 400 || !this.extraFieldsOk) throw e
        this.extraFieldsOk = false
        data = await fetchChunk(CORE_FIELDS)
      }
      out.push(...data.value.filter(Boolean))
    }
    // keep WIQL order
    const order = new Map(ids.map((id, i) => [id, i]))
    out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return this.mapItems(out)
  }

  async getItem(id: number): Promise<WorkItem> {
    assertId(id)
    const r = await this.req<{ id: number; rev: number; fields: Record<string, unknown> }>(
      `${this.org}/_apis/wit/workitems/${id}?${API}`
    )
    const [item] = await this.mapItems([r])
    return item
  }

  /** Everything assigned to me that isn't closed, plus things I closed in the last 7 days. */
  async myWork(): Promise<WorkItem[]> {
    const { done, removed } = await this.closedStates()
    const closed = [...done, ...removed].map(wiqlString).join(', ')
    const doneList = done.map(wiqlString).join(', ')
    const ids = await this.wiql(
      `SELECT [System.Id] FROM WorkItems
       WHERE [System.TeamProject] = @project
         AND [System.AssignedTo] = @Me
         AND ( [System.State] NOT IN (${closed})
               OR ([System.State] IN (${doneList}) AND [System.ChangedDate] >= @Today - 7) )
       ORDER BY [System.ChangedDate] DESC`,
      300,
      this.cfg.project
    )
    return this.getItems(ids)
  }

  async search(q: SearchQuery): Promise<WorkItem[]> {
    const text = q.text.trim()
    const where: string[] = []
    if (!q.allProjects) where.push('[System.TeamProject] = @project')
    const idMatch = text.match(/^#?(\d+)$/)
    if (idMatch) {
      where.push(`[System.Id] = ${Number(idMatch[1])}`)
    } else if (text) {
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const w = wiqlString(word)
        where.push(
          q.includeDescription
            ? `([System.Title] CONTAINS ${w} OR [System.Description] CONTAINS ${w})`
            : `[System.Title] CONTAINS ${w}`
        )
      }
    }
    if (q.types?.length) where.push(`[System.WorkItemType] IN (${q.types.map(wiqlString).join(', ')})`)
    if (q.assigned === 'me') where.push('[System.AssignedTo] = @Me')
    if (q.assigned === 'unassigned') where.push("[System.AssignedTo] = ''")
    if (q.status && q.status !== 'any' && !idMatch) {
      const { done, removed } = await this.closedStates(q.allProjects ? undefined : this.cfg.project)
      const list = [...done, ...removed].map(wiqlString).join(', ')
      where.push(q.status === 'active' ? `[System.State] NOT IN (${list})` : `[System.State] IN (${list})`)
    }
    if (where.length === 0) where.push('[System.ChangedDate] >= @Today - 30')
    const ids = await this.wiql(
      `SELECT [System.Id] FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [System.ChangedDate] DESC`,
      100,
      q.allProjects ? null : this.cfg.project
    )
    return this.getItems(ids)
  }

  async getDetails(id: number): Promise<WorkItem> {
    assertId(id)
    const r = await this.req<{ id: number; rev: number; fields: Record<string, unknown> }>(
      `${this.org}/_apis/wit/workitems/${id}?${API}`
    )
    const [item] = await this.mapItems([r])
    return item
  }

  async getComments(id: number, project = this.cfg.project): Promise<Comment[]> {
    assertId(id)
    const data = await this.req<{
      comments: { id: number; text: string; createdBy: { displayName: string }; createdDate: string }[]
    }>(`${this.projectUrl(project)}/_apis/wit/workItems/${id}/comments?$top=100&order=desc&${COMMENTS_API}`)
    return data.comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdBy: c.createdBy?.displayName ?? '?',
      createdDate: c.createdDate
    }))
  }

  async addComment(id: number, html: string, project = this.cfg.project): Promise<void> {
    assertId(id)
    await this.req(`${this.projectUrl(project)}/_apis/wit/workItems/${id}/comments?${COMMENTS_API}`, {
      method: 'POST',
      body: JSON.stringify({ text: html })
    })
  }

  /**
   * fields: ADO reference name → value (null removes). `parent` (a card id, or null to remove) goes in the same PATCH,
   * so a refused link or a rule error leaves the old parent and every field as they were.
   */
  async updateItem(id: number, fields: Record<string, unknown>, parent?: number | null): Promise<WorkItem> {
    assertId(id)
    const ops: unknown[] = Object.entries(fields).map(([k, v]) =>
      v === null ? { op: 'remove', path: `/fields/${assertField(k)}` } : { op: 'add', path: `/fields/${assertField(k)}`, value: v }
    )
    const url = `${this.org}/_apis/wit/workitems/${id}`
    if (parent !== undefined) {
      if (parent !== null) assertId(parent)
      const cur = await this.req<{ id: number; rev: number; relations?: Relation[] }>(`${url}?$expand=relations&${API}`)
      ops.unshift(...parentPatch(this.org, cur, parent))
    }
    if (!ops.length) return this.getItem(id)
    await this.req(`${url}?${API}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(ops)
    })
    return this.getItem(id)
  }

  /** Backlog level of every type in the project (task < requirement < feature < epic), for the parent picker. */
  async getTypeLevels(project = this.cfg.project): Promise<TypeLevels> {
    const cached = this.levels.get(project)
    if (cached) return cached
    const data = await this.req<{ value: { referenceName: string; workItemTypes?: { name: string }[] }[] }>(
      `${this.projectUrl(project)}/_apis/wit/workitemtypecategories?${API}`
    )
    const levels = levelsFromCategories(data.value)
    this.levels.set(project, levels)
    return levels
  }

  async assignToMe(id: number): Promise<WorkItem> {
    const me = await this.getMe()
    return this.updateItem(id, { 'System.AssignedTo': me.email ?? me.name })
  }

  async currentIteration(): Promise<string | undefined> {
    if (!this.cfg.team) return undefined
    const data = await this.req<{ value: { path: string }[] }>(
      `${this.projectUrl()}/${encodeURIComponent(this.cfg.team)}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`
    )
    return data.value[0]?.path
  }

  private async allFields(project = this.cfg.project): Promise<Map<string, { kind: FieldKind; readOnly: boolean; name: string }>> {
    const cached = this.fieldKinds.get(project)
    if (cached) return cached
    const data = await this.req<{ value: { referenceName: string; name: string; type: string; readOnly?: boolean }[] }>(
      `${this.projectUrl(project)}/_apis/wit/fields?${API}`
    )
    const map = new Map(data.value.map((f) => [f.referenceName, { kind: KIND[f.type] ?? 'other', readOnly: !!f.readOnly, name: f.name }]))
    this.fieldKinds.set(project, map)
    return map
  }

  /** Reference name of the process's "Time Estimate" field, if it has one. */
  private async timeEstimateRef(project: string): Promise<string | undefined> {
    if (this.timeEstimateRefs.has(project)) return this.timeEstimateRefs.get(project)
    const all = await this.allFields(project).catch(() => undefined)
    if (!all) return undefined // try again next time
    const ref = [...all].find(([, f]) => isTimeEstimate(f.name))?.[0]
    this.timeEstimateRefs.set(project, ref)
    return ref
  }

  /** Fields of a work item type with required flags, defaults and allowed values. */
  async typeFields(type: string, project = this.cfg.project): Promise<FieldSpec[]> {
    const key = `${project}|${type}`
    const cached = this.typeFieldCache.get(key)
    if (cached) return cached
    const [kinds, data] = await Promise.all([
      this.allFields(project),
      this.req<{
        value: { referenceName: string; name: string; alwaysRequired?: boolean; defaultValue?: unknown; allowedValues?: unknown[]; helpText?: string }[]
      }>(`${this.projectUrl(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=allowedValues&${API}`)
    ])
    const specs: FieldSpec[] = data.value.map((f) => {
      const k = kinds.get(f.referenceName)
      return {
        referenceName: f.referenceName,
        name: f.name,
        kind: k?.kind ?? 'other',
        alwaysRequired: !!f.alwaysRequired,
        readOnly: k?.readOnly ?? false,
        defaultValue: f.defaultValue ?? undefined,
        allowedValues: f.allowedValues?.length ? f.allowedValues.map(String) : undefined,
        helpText: f.helpText || undefined
      }
    })
    this.typeFieldCache.set(key, specs)
    return specs
  }

  /** Map rule errors onto field specs so the UI can show the right input. */
  async explainRuleErrors(e: AdoError, type: string, project = this.cfg.project): Promise<FieldError[]> {
    const errors = parseRuleErrors(e.message, e.body)
    if (!errors.length) return []
    const specs = await this.typeFields(type, project).catch(() => [] as FieldSpec[])
    return errors.map((fe) => {
      const field =
        specs.find((s) => fe.referenceName && s.referenceName.toLowerCase() === fe.referenceName.toLowerCase()) ??
        specs.find((s) => s.name.toLowerCase() === fe.name.toLowerCase())
      return { ...fe, referenceName: field?.referenceName ?? fe.referenceName, name: field?.name ?? fe.name, field }
    })
  }

  async createItem(input: CreateItemInput): Promise<WorkItem> {
    const ops: unknown[] = [{ op: 'add', path: '/fields/System.Title', value: input.title }]
    if (input.description) ops.push({ op: 'add', path: '/fields/System.Description', value: input.description })
    if (input.assignToMe) {
      const me = await this.getMe()
      ops.push({ op: 'add', path: '/fields/System.AssignedTo', value: me.email ?? me.name })
    }
    if (input.currentIteration) {
      const it = await this.currentIteration().catch(() => undefined)
      if (it) ops.push({ op: 'add', path: '/fields/System.IterationPath', value: it })
    }
    if (input.tags?.length) ops.push({ op: 'add', path: '/fields/System.Tags', value: input.tags.join('; ') })
    if (input.remainingWork != null)
      ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: input.remainingWork })
    for (const [k, v] of Object.entries(input.fields ?? {})) {
      if (v === undefined || v === null || v === '') continue
      ops.push({ op: 'add', path: `/fields/${assertField(k)}`, value: v })
    }
    if (input.parentId) assertId(input.parentId)
    if (input.parentId) ops.push({ op: 'add', path: '/relations/-', value: parentLink(this.org, input.parentId) })
    const r = await this.req<{ id: number }>(
      `${this.projectUrl()}/_apis/wit/workitems/$${encodeURIComponent(input.type)}?${API}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(ops) }
    )
    return this.getItem(r.id)
  }
}
