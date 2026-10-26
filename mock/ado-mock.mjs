// Fake Azure DevOps REST API for local development.
// Run: npm run mock   → org URL http://localhost:7071/mockorg, project "Platform", team "Platform Team", any PAT.
import http from 'node:http'

const PORT = Number(process.env.PORT ?? 7071)
const ORG = 'mockorg'
const ME = { displayName: 'Jesse Example', uniqueName: 'jesse@example.com', id: 'me-guid' }
const OTHERS = [
  { displayName: 'Sam Rivera', uniqueName: 'sam@example.com', id: 'sam' },
  { displayName: 'Priya Patel', uniqueName: 'priya@example.com', id: 'priya' }
]
const STATES = [
  { name: 'New', color: 'b2b2b2', category: 'Proposed' },
  { name: 'Active', color: '007acc', category: 'InProgress' },
  { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
  { name: 'Waiting for Code Review', color: 'b4009e', category: 'Resolved' },
  { name: 'Closed', color: '339933', category: 'Completed' },
  { name: 'Removed', color: 'ffffff', category: 'Removed' }
]
const SCRUM_STATES = [
  { name: 'New', color: 'b2b2b2', category: 'Proposed' },
  { name: 'Approved', color: '5688e0', category: 'Proposed' },
  { name: 'Committed', color: '007acc', category: 'InProgress' },
  { name: 'Done', color: '339933', category: 'Completed' },
  { name: 'Removed', color: 'ffffff', category: 'Removed' }
]
const TYPES = [
  ['Epic', 'FF7B00'], ['Feature', '773B93'], ['User Story', '009CCC'], ['Product Backlog Item', '009CCC'], ['Task', 'F2CB1D'], ['Bug', 'CC293D']
].map(([name, color]) => ({
  name,
  color,
  isDisabled: false,
  states:
    name === 'Product Backlog Item'
      ? SCRUM_STATES
      : name === 'Task'
        ? STATES.filter((s) => s.name !== 'Resolved')
        : name === 'Bug'
          ? [...STATES.slice(0, 2), { name: 'In Test', color: '8a4fd8', category: 'InProgress' }, ...STATES.slice(2)]
          : STATES
}))

// The team's backlog-items board: Dev and Test share "Active" for stories (only the column field tells them
// apart), and PBIs have no Review column (dragging one there is refused).
const BOARD_FIELD = 'WEF_6CB513B6E70E43499D9FC94E5BBFB784_Kanban.Column'
const BOARD = [
  ['New', 'incoming', { 'User Story': 'New', Bug: 'New', 'Product Backlog Item': 'New' }],
  ['Ready', 'inProgress', { 'User Story': 'New', Bug: 'New', 'Product Backlog Item': 'Approved' }],
  ['Dev', 'inProgress', { 'User Story': 'Active', Bug: 'Active', 'Product Backlog Item': 'Committed' }],
  ['Test', 'inProgress', { 'User Story': 'Active', Bug: 'In Test', 'Product Backlog Item': 'Committed' }],
  ['Review', 'inProgress', { 'User Story': 'Waiting for Code Review', Bug: 'Resolved' }],
  ['Closed', 'outgoing', { 'User Story': 'Closed', Bug: 'Closed', 'Product Backlog Item': 'Done' }]
].map(([name, columnType, stateMappings]) => ({ id: name.toLowerCase(), name, columnType, stateMappings, isSplit: false, itemLimit: 0 }))
const boardColumnFor = (type, state) => BOARD.find((c) => c.stateMappings[type] === state)?.name

// Field definitions (subset) and per-type rules, like a customised process would have.
const FIELDS = [
  ['System.Title', 'Title', 'string'], ['System.Description', 'Description', 'html'], ['System.State', 'State', 'string'],
  ['System.AssignedTo', 'Assigned To', 'identity'], ['System.AreaPath', 'Area Path', 'treePath'], ['System.IterationPath', 'Iteration Path', 'treePath'],
  ['System.Tags', 'Tags', 'plainText'], ['Microsoft.VSTS.Common.Priority', 'Priority', 'integer'],
  ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance Criteria', 'html'], ['Microsoft.VSTS.Scheduling.Effort', 'Effort', 'double'],
  ['Microsoft.VSTS.Common.ValueArea', 'Value Area', 'string'], ['Microsoft.VSTS.Scheduling.RemainingWork', 'Remaining Work', 'double'],
  ['Custom.Customer', 'Customer', 'picklistString'], ['Custom.TimeEstimate', 'Time Estimate', 'double'], ['System.Id', 'ID', 'integer'], ['System.CreatedBy', 'Created By', 'identity']
].map(([referenceName, name, type]) => ({ referenceName, name, type, readOnly: referenceName === 'System.Id' || referenceName === 'System.CreatedBy' }))

function typeFields(type) {
  const f = (ref, extra = {}) => ({ ...FIELDS.find((x) => x.referenceName === ref), alwaysRequired: false, ...extra })
  const list = [
    f('System.Title', { alwaysRequired: true }), f('System.Description'), f('System.State', { alwaysRequired: true, defaultValue: 'New' }),
    f('System.AssignedTo'), f('System.AreaPath', { alwaysRequired: true, defaultValue: 'Platform' }), f('System.IterationPath', { alwaysRequired: true, defaultValue: 'Platform' }),
    f('System.Tags'), f('Microsoft.VSTS.Common.Priority', { allowedValues: [1, 2, 3, 4], defaultValue: 2 }), f('System.Id'), f('System.CreatedBy')
  ]
  if (type === 'Product Backlog Item') {
    list.find((x) => x.referenceName === 'System.Description').alwaysRequired = true
    list.push(
      f('Microsoft.VSTS.Common.AcceptanceCriteria'),
      f('Microsoft.VSTS.Scheduling.Effort'),
      f('Microsoft.VSTS.Common.ValueArea', { alwaysRequired: true, defaultValue: 'Business', allowedValues: ['Architectural', 'Business'] }),
      f('Custom.Customer', { alwaysRequired: true, allowedValues: ['Contoso', 'Fabrikam', 'Internal'], helpText: 'Who asked for this?' })
    )
  }
  if (type === 'Task') list.push(f('Microsoft.VSTS.Scheduling.RemainingWork'))
  // an org-added field, found by its display name (no fixed reference name)
  if (['Task', 'Bug', 'User Story', 'Product Backlog Item'].includes(type)) list.push(f('Custom.TimeEstimate', { helpText: 'Hours' }))
  return list
}

/** Rules ADO would enforce; returns rule errors for an item after a change. */
function ruleErrors(it) {
  const errs = []
  const type = it.fields['System.WorkItemType']
  for (const fd of typeFields(type)) {
    if (!fd.alwaysRequired || fd.defaultValue !== undefined) continue
    const v = it.fields[fd.referenceName]
    if (v === undefined || v === null || String(v).replace(/<[^>]*>/g, '').trim() === '') errs.push({ fd, flags: 'required, invalidEmpty' })
  }
  // conditional rule: committing a PBI needs an effort estimate
  if (type === 'Product Backlog Item' && it.fields['System.State'] === 'Committed' && !it.fields['Microsoft.VSTS.Scheduling.Effort'])
    errs.push({ fd: FIELDS.find((x) => x.referenceName === 'Microsoft.VSTS.Scheduling.Effort'), flags: 'required, invalidEmpty' })
  return errs
}

function ruleErrorResponse(res, errs, withCustomProperties) {
  const msg = errs.map((e) => `TF401320: Rule Error for field ${e.fd.name}. Error code: Required, InvalidEmpty.`).join(' ')
  return json(res, 400, {
    message: msg,
    typeKey: 'RuleValidationException',
    ...(withCustomProperties
      ? { customProperties: { RuleValidationErrors: errs.map((e) => ({ fieldReferenceName: e.fd.referenceName, fieldStatusFlags: e.flags, errorMessage: `TF401320: Rule Error for field ${e.fd.name}. Error code: Required, InvalidEmpty.` })) } }
      : {})
  })
}

const ITERATIONS = [
  { name: 'Sprint 41', path: 'Platform\\Sprint 41', attributes: { startDate: '2026-10-05T00:00:00Z', timeFrame: 'past' } },
  { name: 'Sprint 42', path: 'Platform\\Sprint 42', attributes: { startDate: '2026-10-19T00:00:00Z', timeFrame: 'current' } },
  { name: 'Sprint 43', path: 'Platform\\Sprint 43', attributes: { startDate: '2026-11-02T00:00:00Z', timeFrame: 'future' } }
]
const AREAS = ['Platform', 'Platform\\Core', 'Platform\\Core\\Auth', 'Platform\\Reporting']
const day = 864e5
const iso = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString()
let nextId = 4100
const items = new Map()
const comments = new Map()

const parentRel = (id) => ({ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `http://localhost:${PORT}/${ORG}/_apis/wit/workItems/${id}`, attributes: { name: 'Parent' } })
// backlog level per type, like ADO's work item type categories (task < requirement < feature < epic)
const LEVEL = { Task: 0, Bug: 1, 'User Story': 1, 'Product Backlog Item': 1, Feature: 2, Epic: 3 }
const linkError = (res, _code, msg) => json(res, 400, { message: msg, typeKey: 'WorkItemLinkValidationException', errorCode: 0, eventId: 3200 })

function add(type, title, state, opts = {}) {
  const id = nextId++
  const f = {
    'System.Id': id,
    'System.Title': title,
    'System.WorkItemType': type,
    'System.State': state,
    'System.TeamProject': opts.project ?? 'Platform',
    'System.AssignedTo': opts.assigned === undefined ? ME : opts.assigned,
    'System.ChangedDate': iso(opts.changed ?? 1),
    'System.CreatedDate': iso((opts.changed ?? 1) + 5),
    'Microsoft.VSTS.Common.StateChangeDate': iso(opts.stateChanged ?? opts.changed ?? 1),
    'System.IterationPath': opts.iteration ?? 'Platform\\Sprint 42',
    'System.AreaPath': 'Platform',
    'System.Tags': opts.tags ?? '',
    'Microsoft.VSTS.Common.Priority': opts.priority ?? 2,
    'System.Description': opts.description ?? `<p>${title}. Details go here.</p>`,
    'System.BoardColumn': boardColumnFor(type, state)
  }
  if (opts.parent) f['System.Parent'] = opts.parent
  if (opts.estimate != null) f['Custom.TimeEstimate'] = opts.estimate
  if (type === 'Task') {
    f['Microsoft.VSTS.Scheduling.RemainingWork'] = opts.remaining ?? 4
    f['Microsoft.VSTS.Scheduling.CompletedWork'] = opts.completed ?? 0
  }
  items.set(id, { id, rev: 1, fields: f, relations: opts.parent ? [parentRel(opts.parent)] : [] })
  comments.set(id, opts.comments ?? [])
  return id
}

const epic = add('Epic', 'Self-service onboarding', 'Active', { assigned: OTHERS[0], changed: 10 })
const feat = add('Feature', 'SSO for partner portal', 'Active', { assigned: OTHERS[1], parent: epic, changed: 4 })
const s1 = add('User Story', 'Partner can sign in with Entra ID', 'Active', { parent: feat, changed: 0, tags: 'auth; partner' })
add('Task', 'Register app in Entra and store client secret', 'Active', { parent: s1, changed: 5, stateChanged: 6, remaining: 2, completed: 3, estimate: 5 })
add('Task', 'Wire OIDC callback handler', 'New', { parent: s1, changed: 2, remaining: 6 })
add('Bug', 'Login redirect loops when cookie is stale', 'Active', { changed: 4, stateChanged: 4, priority: 1, comments: [
  { id: 1, text: '<div>Repro in staging with an expired cookie.</div>', createdBy: { displayName: 'Sam Rivera' }, createdDate: iso(4) }
] })
add('User Story', 'Audit log export to CSV', 'New', { changed: 1, tags: 'reporting' })
// hostile content: the app must render this inert (see shots security check)
add('Bug', 'Hostile description test', 'New', { assigned: null, changed: 30, description:
  '<p>Normal <a href="https://example.com/ok">https link</a></p>' +
  '<a href="//evil.example/share/x.html">protocol-relative</a> <a href="file:///C:/Windows/win.ini">file</a> ' +
  '<a href="javascript:alert(1)">js</a> <img src="//evil.example/share/pixel.png"> <img src=x onerror="window.tl.call(\'getSettings\')"> ' +
  '<iframe src="https://evil.example"></iframe><svg onload="alert(1)"></svg><form action="https://evil.example"><input name=a></form>' })
add('Task', 'Write runbook for cert rotation', 'New', { changed: 8, remaining: 3 })
add('Bug', 'Dashboard tiles flicker on resize', 'Resolved', { changed: 1 })
// Scrum-style item: moving it to Committed needs an Effort (conditional rule)
add('Product Backlog Item', 'Bulk export of audit events', 'Approved', { changed: 1, tags: 'reporting' })
// worst case for card layout: long unbroken words and a long state name
add('User Story', 'Migrate PartnerPortal.Authentication.OpenIdConnectHandlerConfiguration to the new tenant-wide settings service', 'Waiting for Code Review', { changed: 2, tags: 'auth; tech-debt' })
add('Task', 'Update pipeline to Node 24', 'Closed', { changed: 0 })
add('Task', 'Clean up feature flags', 'Closed', { changed: 3 })
add('User Story', 'Rate limit public API', 'New', { assigned: null, changed: 2 })
add('Bug', 'Typo in password reset email', 'New', { assigned: OTHERS[0], changed: 6 })
add('Feature', 'Billing v2', 'New', { assigned: OTHERS[1], changed: 20, project: 'Billing' })
add('Task', 'Spike: evaluate Stripe tax', 'Active', { project: 'Billing', changed: 9, stateChanged: 9 })
for (let i = 0; i < 12; i++) add('Task', `Backlog chore #${i + 1}: tidy config ${i}`, 'New', { assigned: i % 2 ? null : OTHERS[0], changed: 15 + i })
// parent picker data: more Features/Epics to search, one in Billing, one closed (appended so earlier ids stay put)
add('Feature', 'SSO session timeouts', 'New', { assigned: OTHERS[1], parent: epic, changed: 3 })
add('Feature', 'Audit and compliance', 'Active', { assigned: null, changed: 6 })
add('Epic', 'Billing platform', 'Active', { assigned: OTHERS[0], changed: 12, project: 'Billing' })
add('Feature', 'Legacy SSO retirement', 'Closed', { assigned: OTHERS[1], changed: 30 })

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

// Evaluate the small WIQL subset Golau generates by translating it to JS.
function wiqlFilter(query, project) {
  const where = (query.match(/WHERE([\s\S]*?)(ORDER BY|$)/i)?.[1] ?? 'true').trim()
  const str = (s) => JSON.stringify(s.slice(1, -1).replace(/''/g, "'"))
  const list = (l) => '[' + (l.match(/'(?:[^']|'')*'/g) ?? []).map(str).join(',') + ']'
  let js = where
    .replace(/\[([\w.]+)\]\s+NOT IN\s*\(([^)]*)\)/gi, (_, f, l) => `!${list(l)}.includes(F(${JSON.stringify(f)}))`)
    .replace(/\[([\w.]+)\]\s+IN\s*\(([^)]*)\)/gi, (_, f, l) => `${list(l)}.includes(F(${JSON.stringify(f)}))`)
    .replace(/\[([\w.]+)\]\s+CONTAINS\s+('(?:[^']|'')*')/gi, (_, f, w) => `String(F(${JSON.stringify(f)})??'').toLowerCase().includes(${str(w)}.toLowerCase())`)
    .replace(/\[([\w.]+)\]\s*>=\s*@Today\s*-\s*(\d+)/gi, (_, f, n) => `new Date(F(${JSON.stringify(f)})).getTime() >= TODAY - ${n}*864e5`)
    .replace(/\[([\w.]+)\]\s*=\s*@Me/gi, (_, f) => `F(${JSON.stringify(f)})?.uniqueName === ${JSON.stringify(ME.uniqueName)}`)
    .replace(/\[([\w.]+)\]\s*=\s*@project/gi, (_, f) => `F(${JSON.stringify(f)}) === ${JSON.stringify(project)}`)
    .replace(/\[([\w.]+)\]\s*=\s*''/gi, (_, f) => `!F(${JSON.stringify(f)})`)
    .replace(/\[([\w.]+)\]\s*=\s*(\d+)/gi, (_, f, n) => `F(${JSON.stringify(f)}) === ${n}`)
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // eslint-disable-next-line no-new-func
  const fn = new Function('F', 'TODAY', `return (${js})`)
  return (it) => fn((k) => it.fields[k], today.getTime())
}

const body = (req) =>
  new Promise((ok) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => ok(b ? JSON.parse(b) : {}))
  })

// like ADO's link rules: the test op, an existing parent, a parent that exists, one level up, no loops
function relationErrors(it, ops) {
  let parent = it.fields['System.Parent']
  for (const op of ops) {
    if (op.op === 'test' && op.path === '/rev' && op.value !== it.rev) return `TF401028: The updated value for the field 'Rev' does not match the current revision (${it.rev}).`
    if (op.op === 'remove' && op.path.startsWith('/relations/')) {
      if (!it.relations[Number(op.path.slice(11))]) return `Relation index ${op.path.slice(11)} does not exist on work item ${it.id}.`
      if (it.relations[Number(op.path.slice(11))].rel === 'System.LinkTypes.Hierarchy-Reverse') parent = undefined
    }
    if (op.path === '/relations/-' && op.value?.rel === 'System.LinkTypes.Hierarchy-Reverse') {
      const pid = Number(op.value.url.split('/').pop())
      const p = items.get(pid)
      if (!p) return `TF401232: Work item ${pid} does not exist, or you do not have permissions to read it.`
      if (parent) return `TF201036: You cannot add a Parent link between work items ${it.id} and ${pid} because a work item can have only one Parent link.`
      if (pid === it.id) return `TF201036: You cannot add a Parent link between work items ${it.id} and ${pid} because a work item cannot be linked to itself.`
      for (let a = p; a; a = items.get(a.fields['System.Parent']))
        if (a.id === it.id) return `TF201035: You cannot add a Parent link between work items ${it.id} and ${pid} because it would create a circular link.`
      const [cl, pl] = [LEVEL[it.fields['System.WorkItemType']], LEVEL[p.fields['System.WorkItemType']]]
      if (cl !== undefined && pl !== undefined && pl !== cl + 1 && !(cl === 0 && pl === 1))
        return `TF201036: You cannot add a Parent link between work items ${it.id} and ${pid}: a ${p.fields['System.WorkItemType']} cannot be the parent of a ${it.fields['System.WorkItemType']}.`
    }
  }
  return ''
}

function applyPatch(it, ops) {
  for (const op of ops) {
    if (op.path.startsWith('/fields/')) {
      const k = op.path.slice(8)
      if (op.op === 'remove') delete it.fields[k]
      else if (k === 'System.AssignedTo') it.fields[k] = [ME, ...OTHERS].find((p) => p.uniqueName === op.value || p.displayName === op.value) ?? ME
      else if (k === 'System.History') comments.get(it.id).unshift({ id: Date.now(), text: op.value, createdBy: ME, createdDate: new Date().toISOString() })
      else if (k === BOARD_FIELD) it.fields['System.BoardColumn'] = op.value
      else {
        if (k === 'System.State' && it.fields[k] !== op.value) it.fields['Microsoft.VSTS.Common.StateChangeDate'] = new Date().toISOString()
        it.fields[k] = op.value
      }
    } else if (op.op === 'remove' && op.path.startsWith('/relations/')) {
      const [gone] = it.relations.splice(Number(op.path.slice(11)), 1)
      if (gone?.rel === 'System.LinkTypes.Hierarchy-Reverse') delete it.fields['System.Parent']
    } else if (op.path === '/relations/-' && op.value.rel === 'System.LinkTypes.Hierarchy-Reverse') {
      it.relations.push(parentRel(Number(op.value.url.split('/').pop())))
      it.fields['System.Parent'] = Number(op.value.url.split('/').pop())
    }
  }
  it.rev++
  it.fields['System.ChangedDate'] = new Date().toISOString()
  // like ADO: a state change without a column puts the card in the first column for that state
  const type = it.fields['System.WorkItemType']
  const col = BOARD.find((c) => c.name === it.fields['System.BoardColumn'])
  if (!col || col.stateMappings[type] !== it.fields['System.State']) it.fields['System.BoardColumn'] = boardColumnFor(type, it.fields['System.State'])
  if (!it.fields['System.BoardColumn']) delete it.fields['System.BoardColumn']
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const p = decodeURIComponent(url.pathname)
      .split('/')
      .filter(Boolean)
    if (process.env.MOCK_LOG) console.log(req.method, url.pathname)
    if (p[0] !== ORG) return json(res, 404, { message: 'no such org' })
    if (!req.headers.authorization) return json(res, 401, { message: 'auth required' })
    if (process.env.MOCK_DELAY) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY)))
    const rest = p.slice(1)
    const apiAt = rest.indexOf('_apis')
    const scope = rest.slice(0, apiAt) // [] | [project] | [project, team]
    const api = rest.slice(apiAt + 1)
    const project = scope[0] ?? 'Platform'
    const key = api.join('/')

    try {
      if (key === 'connectionData')
        return json(res, 200, { authenticatedUser: { id: ME.id, providerDisplayName: ME.displayName, properties: { Account: { $value: ME.uniqueName } } } })
      if (key === 'projects') return json(res, 200, { value: [{ name: 'Platform' }, { name: 'Billing' }] })
      if (api[0] === 'projects' && api[2] === 'teams' && api[4] === 'members')
        return json(res, 200, { count: 3, value: [ME, ...OTHERS].map((p, i) => ({ isTeamAdmin: i === 0, identity: { id: p.id ?? `p-${i}`, displayName: p.displayName, uniqueName: p.uniqueName } })) })
      if (api[0] === 'projects' && api[2] === 'teams') return json(res, 200, { value: [{ name: `${api[1]} Team` }, { name: 'Ops' }] })
      if (key === 'wit/classificationnodes/iterations') return json(res, 200, { name: 'Platform', path: '\\Platform\\Iteration', children: ITERATIONS.map((i) => ({ name: i.name, path: `\\Platform\\Iteration\\${i.name}`, attributes: { startDate: i.attributes.startDate } })) })
      if (key === 'wit/classificationnodes/areas') return json(res, 200, { name: 'Platform', path: '\\Platform\\Area', children: [{ name: 'Core', path: '\\Platform\\Area\\Core', children: [{ name: 'Auth', path: '\\Platform\\Area\\Core\\Auth' }] }, { name: 'Reporting', path: '\\Platform\\Area\\Reporting' }] })
      if (key === 'wit/tags') return json(res, 200, { count: 4, value: ['api', 'auth', 'partner', 'reporting'].map((name, i) => ({ id: `t${i}`, name })) })
      if (key === 'wit/workitemtypes') return json(res, 200, { value: TYPES })
      if (key === 'wit/fields') return json(res, 200, { value: FIELDS })
      if (api[0] === 'wit' && api[1] === 'workitemtypes' && api[3] === 'fields') return json(res, 200, { value: typeFields(api[2]) })
      if (key === 'wit/wiql' && req.method === 'POST') {
        const { query } = await body(req)
        const top = Number(url.searchParams.get('$top') ?? 200)
        const filt = wiqlFilter(query, project)
        const found = [...items.values()]
          .filter(filt)
          .sort((a, b) => b.fields['System.ChangedDate'].localeCompare(a.fields['System.ChangedDate']))
          .slice(0, top)
        return json(res, 200, { workItems: found.map((i) => ({ id: i.id })) })
      }
      if (key === 'wit/workitemsbatch') {
        const { ids, fields } = await body(req)
        return json(res, 200, {
          value: ids.map((id) => items.get(id)).filter(Boolean).map((i) => ({
            id: i.id,
            rev: i.rev,
            fields: Object.fromEntries(Object.entries(i.fields).filter(([k]) => !fields || fields.includes(k)))
          }))
        })
      }
      if (api[0] === 'wit' && api[1].toLowerCase() === 'workitems' && api[2]?.startsWith('$') && req.method === 'POST') {
        const ops = await body(req)
        const id = add(api[2].slice(1), 'untitled', 'New', { assigned: null, changed: 0, project })
        const it = items.get(id)
        it.fields['System.Description'] = ''
        applyPatch(it, ops)
        const errs = ruleErrors(it)
        if (errs.length) {
          items.delete(id)
          nextId--
          return ruleErrorResponse(res, errs, true)
        }
        return json(res, 200, { id })
      }
      if (api[0] === 'wit' && api[1].toLowerCase() === 'workitems' && api[3] === 'comments') {
        const id = Number(api[2])
        if (!items.has(id)) return json(res, 404, { message: `TF401232: Work item ${id} does not exist.` })
        if (req.method === 'POST') {
          const { text } = await body(req)
          comments.get(id).unshift({ id: Date.now(), text, createdBy: ME, createdDate: new Date().toISOString() })
          items.get(id).fields['System.ChangedDate'] = new Date().toISOString()
          return json(res, 200, {})
        }
        return json(res, 200, { comments: comments.get(id) })
      }
      if (api[0] === 'wit' && api[1].toLowerCase() === 'workitems' && api[2]) {
        const it = items.get(Number(api[2]))
        if (!it) return json(res, 404, { message: `TF401232: Work item ${api[2]} does not exist.` })
        if (req.method === 'PATCH') {
          const trial = structuredClone(it)
          const ops = await body(req)
          // like ADO: a path that is not in the project's tree is refused
          for (const op of ops) {
            const f = op.path?.slice(8)
            if (op.op !== 'remove' && f === 'System.IterationPath' && !ITERATIONS.some((i) => i.path === op.value) && op.value !== 'Platform')
              return linkError(res, 0, `TF401347: Invalid tree name given for work item ${it.id}, field 'System.IterationPath'.`)
            if (op.op !== 'remove' && f === 'System.AreaPath' && !AREAS.includes(op.value))
              return linkError(res, 0, `TF401347: Invalid tree name given for work item ${it.id}, field 'System.AreaPath'.`)
          }
          const bad = relationErrors(trial, ops)
          if (bad) return linkError(res, 0, bad)
          applyPatch(trial, ops)
          const errs = ruleErrors(trial)
          // message-only error (no customProperties) to exercise the app's fallback parser
          if (errs.length) return ruleErrorResponse(res, errs, false)
          Object.assign(it, trial)
        }
        const { relations, ...plain } = it
        // like ADO's plain GET: no relations, and no System.Parent unless relations are expanded (only the link says who the parent is)
        if (url.searchParams.get('$expand') === 'relations') return json(res, 200, it)
        const { 'System.Parent': _p, ...fieldsNoParent } = plain.fields
        return json(res, 200, { ...plain, fields: fieldsNoParent })
      }
      if (key === 'wit/workitemtypecategories')
        return json(res, 200, { value: [
          { referenceName: 'Microsoft.EpicCategory', workItemTypes: [{ name: 'Epic' }] },
          { referenceName: 'Microsoft.FeatureCategory', workItemTypes: [{ name: 'Feature' }] },
          { referenceName: 'Microsoft.RequirementCategory', workItemTypes: [{ name: 'User Story' }, { name: 'Product Backlog Item' }, { name: 'Bug' }] },
          { referenceName: 'Microsoft.TaskCategory', workItemTypes: [{ name: 'Task' }] }
        ] })
      if (key === 'work/backlogs' && scope[1])
        return json(res, 200, { value: [
          { id: 'Microsoft.EpicCategory', name: 'Epics', type: 'portfolio', rank: 3 },
          { id: 'Microsoft.FeatureCategory', name: 'Features', type: 'portfolio', rank: 2 },
          { id: 'Microsoft.RequirementCategory', name: 'Stories', type: 'requirement', rank: 1 },
          { id: 'Microsoft.TaskCategory', name: 'Tasks', type: 'task', rank: 0 }
        ] })
      if (api[0] === 'work' && api[1] === 'boards' && api[2] === 'Stories' && scope[1])
        return json(res, 200, { id: 'stories', name: 'Stories', columns: BOARD, fields: { columnField: { referenceName: BOARD_FIELD }, doneField: { referenceName: BOARD_FIELD.replace('Column', 'Column.Done') } } })
      if (key === 'work/teamsettings/iterations')
        return json(res, 200, { value: url.searchParams.get('$timeframe') === 'current' ? ITERATIONS.filter((i) => i.attributes.timeFrame === 'current') : ITERATIONS })
      return json(res, 404, { message: `mock: no route ${req.method} ${url.pathname}` })
    } catch (e) {
      return json(res, 400, { message: String(e) })
    }
  })
  // localhost only: this server evaluates query text and must never be reachable from the LAN
  .listen(PORT, '127.0.0.1', () => console.log(`ADO mock on http://localhost:${PORT}/${ORG}  (project Platform, team "Platform Team")`))
