import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Settings } from '@shared/types'
import { call } from '../api'
import icon from '../assets/icon.png'

/**
 * First run (and Settings → Connection): org URL + PAT → test → pick project/team.
 * Works on its own, outside the app context, because nothing is connected yet.
 */
export function ConnectionForm({ settings, onDone, compact }: { settings: Settings; onDone?: () => void; compact?: boolean }): ReactNode {
  const [orgUrl, setOrgUrl] = useState(settings.orgUrl || 'https://dev.azure.com/')
  const [pat, setPat] = useState('')
  const [projects, setProjects] = useState<string[] | null>(null)
  const [teams, setTeams] = useState<string[]>([])
  const [project, setProject] = useState(settings.project)
  const [team, setTeam] = useState(settings.team)
  const [me, setMe] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const normalized = (): string => {
    let u = orgUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//.test(u)) u = `https://dev.azure.com/${u}`
    // accept a pasted project/board URL: keep just the org part
    const m = u.match(/^(https:\/\/dev\.azure\.com\/[^/]+)/) ?? u.match(/^(https:\/\/[^/]+\.visualstudio\.com)/)
    return m ? m[1] : u
  }

  const loadTeams = async (p: string): Promise<void> => {
    setProject(p)
    setTeams([])
    if (!p) return
    try {
      const t = await call('listTeams', normalized(), p, pat || undefined)
      setTeams(t)
      setTeam(t.includes(`${p} Team`) ? `${p} Team` : t.includes(team) ? team : '')
    } catch {
      /* teams are optional */
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await call('testConnection', normalized(), pat || undefined)
      setMe(r.me.name)
      setProjects(r.projects)
      setOrgUrl(normalized())
      const p = r.projects.includes(project) ? project : r.projects.length === 1 ? r.projects[0] : ''
      if (p) await loadTeams(p)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (pat) await call('setPat', pat)
    await call('saveSettings', { orgUrl: normalized(), project, team })
    onDone?.()
  }

  return (
    <div className="stack">
      <label className="field">
        Organization URL
        <input className="input" value={orgUrl} onChange={(e) => setOrgUrl(e.target.value)} placeholder="https://dev.azure.com/your-org" />
      </label>
      <label className="field">
        Personal access token {settings.hasPat && <span className="faint">(saved; leave blank to keep it)</span>}
        <input className="input" type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder={settings.hasPat ? '••••••••' : 'paste token'} />
      </label>
      {!compact && (
        <ol className="small">
          <li>
            In Azure DevOps: profile picture → <b>User settings → Personal access tokens → New token</b>.
          </li>
          <li>
            Scope: <b>Work Items: Read & write</b> (add <b>Project and Team: Read</b> to pick a team).
          </li>
          <li>The token is encrypted with your Windows login (DPAPI) and never leaves this machine.</li>
        </ol>
      )}
      <div className="row">
        <button className="btn" disabled={busy || (!pat && !settings.hasPat)} onClick={() => void test()}>
          {busy && <Loader2 size={15} className="spin" />} Test connection
        </button>
        {me && <span className="pill good">Signed in as {me}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {projects && (
        <div className="row wrap" style={{ gap: 14 }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Project
            <select className="select" value={project} onChange={(e) => void loadTeams(e.target.value)}>
              <option value="">Choose…</option>
              {projects.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Team <span className="faint">(optional, for "current sprint")</span>
            <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">None</option>
              {teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {projects && (
        <div className="row">
          <span className="spacer" />
          <button className="btn primary" disabled={!project} onClick={() => void save()}>
            {compact ? 'Save connection' : 'Let\'s go'}
          </button>
        </div>
      )}
    </div>
  )
}

export function Setup({ settings }: { settings: Settings }): ReactNode {
  return (
    <div className="setup">
      <div className="card">
        <div className="row" style={{ gap: 12 }}>
          <img src={icon} alt="" width={40} height={40} />
          <div>
            <h2 style={{ margin: 0 }}>Welcome to Tasklight</h2>
            <div className="muted small">Connect your Azure DevOps board. Takes a minute.</div>
          </div>
        </div>
        <ConnectionForm settings={settings} />
      </div>
    </div>
  )
}
