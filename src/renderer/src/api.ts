import { useEffect, useState } from 'react'
import type { Api } from '../../main/index'
import type { AppState, Route, Settings, WorkItem } from '@shared/types'

type Channel = 'state' | 'settings' | 'work' | 'route' | 'nudge' | 'conn' | 'capture-open'

declare global {
  interface Window {
    tl: {
      call: (method: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: Channel, cb: (payload: unknown) => void) => () => void
      send: (channel: 'nudge-ready') => void
      platform: string
    }
  }
}

/** Typed IPC call into the main process. */
export function call<K extends keyof Api>(method: K, ...args: Parameters<Api[K]>): Promise<Awaited<ReturnType<Api[K]>>> {
  return window.tl.call(method, ...args).catch((e: Error) => {
    // strip Electron's "Error invoking remote method 'tl': Error: " prefix
    throw new Error(String(e.message ?? e).replace(/^Error invoking remote method '\w+': (\w*Error: )?/, ''))
  }) as Promise<Awaited<ReturnType<Api[K]>>>
}

export function on<T>(channel: Channel, cb: (payload: T) => void): () => void {
  return window.tl.on(channel, cb as (p: unknown) => void)
}

export function useAppState(): AppState | null {
  const [s, set] = useState<AppState | null>(null)
  useEffect(() => {
    void call('getState').then(set)
    return on<AppState>('state', (x) => set({ ...x }))
  }, [])
  return s
}

export function useSettings(): Settings | null {
  const [s, set] = useState<Settings | null>(null)
  useEffect(() => {
    void call('getSettings').then(set)
    return on<Settings>('settings', set)
  }, [])
  return s
}

/** My assigned work, kept fresh by the main process. */
export function useWork(): { items: WorkItem[] | null; error: string; refresh: (force?: boolean) => Promise<void> } {
  const [items, setItems] = useState<WorkItem[] | null>(null)
  const [error, setError] = useState('')
  const refresh = async (force = false): Promise<void> => {
    try {
      setItems(await call('myWork', force))
      setError('')
    } catch (e) {
      setError((e as Error).message)
      setItems((x) => x ?? [])
    }
  }
  useEffect(() => {
    void refresh()
    return on<WorkItem[]>('work', (x) => setItems([...x]))
  }, [])
  return { items, error, refresh }
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useRoute(cb: (r: Route) => void): void {
  useEffect(() => on<Route>('route', cb), [cb])
}
