import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarCheck, Inbox as InboxIcon, LayoutGrid, Plus, Search as SearchIcon, Settings as Cog, Sun } from 'lucide-react'
import type { Route, TypeInfo } from '@shared/types'
import { call, on, useAppState, useRoute, useSettings, useWork } from './api'
import { AppCtx, type Ctx } from './components'
import { FocusBar } from './views/FocusBar'
import { Today } from './views/Today'
import { Board } from './views/Board'
import { Search } from './views/Search'
import { ItemDrawer } from './views/ItemDrawer'
import { CreateModal } from './views/CreateModal'
import { PickModal } from './views/PickModal'
import { PlanModal } from './views/PlanModal'
import { EodModal } from './views/EodModal'
import { StaleModal } from './views/StaleModal'
import { Inbox } from './views/Inbox'
import { SettingsView } from './views/Settings'
import { Setup } from './views/Setup'
import icon from './assets/icon.png'

type Page = 'today' | 'work' | 'search' | 'inbox' | 'settings'
type Overlay =
  | { kind: 'plan' | 'eod' | 'stale' | 'pick' }
  | { kind: 'create'; route: Extract<Route, { view: 'create' }> }
  | null

interface Toast {
  id: number
  msg: string
  error?: boolean
  action?: { label: string; run: () => void }
}

export function App(): ReactNode {
  const state = useAppState()
  const settings = useSettings()
  const { items: work, error: workError, refresh } = useWork()
  const [types, setTypes] = useState<TypeInfo[]>([])
  const [page, setPage] = useState<Page>('today')
  const [item, setItem] = useState<number | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [conn, setConn] = useState('')

  const connected = !!settings?.hasPat && !!settings.orgUrl && !!settings.project

  useEffect(() => {
    if (!connected) return
    call('types')
      .then(setTypes)
      .catch(() => undefined)
    void call('connStatus').then(setConn)
    return on<string>('conn', setConn)
  }, [connected, settings?.project])

  // theme
  useEffect(() => {
    const apply = (): void => {
      const t = settings?.theme ?? 'system'
      const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  const toast = useCallback<Ctx['toast']>((msg, opts) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, msg, ...opts }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 9000 : 4000)
  }, [])

  const go = useCallback((r: Route) => {
    if (r.view === 'item') setItem(r.id)
    else if (r.view === 'create') setOverlay({ kind: 'create', route: r })
    else if (r.view === 'plan' || r.view === 'eod' || r.view === 'stale' || r.view === 'pick') setOverlay({ kind: r.view })
    else {
      setPage(r.view)
      setOverlay(null)
    }
  }, [])
  useRoute(go)

  // keyboard: Ctrl+K switch task, Ctrl+N new item, Ctrl+F / "/" search
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOverlay({ kind: 'pick' })
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setOverlay({ kind: 'create', route: { view: 'create' } })
      } else if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (!typing && e.key === '/')) {
        e.preventDefault()
        setPage('search')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const ctx = useMemo<Ctx | null>(
    () =>
      state && settings
        ? { state, settings, work, workError, refreshWork: refresh, types, go, openItem: setItem, toast }
        : null,
    [state, settings, work, workError, refresh, types, go, toast]
  )

  if (!ctx || !settings) return null
  if (!connected) return <Setup settings={settings} />

  const inboxCount = ctx.state.inbox.filter((x) => !x.done).length
  const nav = (p: Page, label: string, Icon: typeof Sun, extra?: ReactNode): ReactNode => (
    <button className={`nav ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>
      <Icon size={17} /> {label}
      {extra}
    </button>
  )

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <img src={icon} alt="" /> Tasklight
          </div>
          {nav('today', 'Today', Sun)}
          {nav('work', 'My work', LayoutGrid)}
          {nav('search', 'Search', SearchIcon, <span className="kbd">/</span>)}
          {nav('inbox', 'Inbox', InboxIcon, inboxCount ? <span className="count">{inboxCount}</span> : null)}
          <div style={{ height: 12 }} />
          <button className="nav" onClick={() => setOverlay({ kind: 'create', route: { view: 'create' } })}>
            <Plus size={17} /> New item <span className="kbd">Ctrl N</span>
          </button>
          <button className="nav" onClick={() => setOverlay({ kind: 'plan' })}>
            <CalendarCheck size={17} /> Plan my day
          </button>
          <div className="bottom">{nav('settings', 'Settings', Cog)}</div>
        </aside>
        <div className="main">
          <div>
            <FocusBar onSwitch={() => setOverlay({ kind: 'pick' })} />
            {conn && <div className="banner">{conn}</div>}
          </div>
          <div className={`content ${item ? 'with-drawer' : ''}`}>
            {page === 'today' && <Today />}
            {page === 'work' && <Board />}
            {page === 'search' && <Search />}
            {page === 'inbox' && <Inbox />}
            {page === 'settings' && <SettingsView />}
          </div>
        </div>
      </div>
      {item && <ItemDrawer id={item} onClose={() => setItem(null)} key={item} />}
      {overlay?.kind === 'pick' && <PickModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'plan' && <PlanModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'eod' && <EodModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'stale' && <StaleModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'create' && <CreateModal route={overlay.route} onClose={() => setOverlay(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                className="btn sm primary"
                onClick={() => {
                  t.action!.run()
                  setToasts((x) => x.filter((y) => y.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  )
}
