import { contextBridge, ipcRenderer } from 'electron'

const listeners = ['state', 'settings', 'work', 'route', 'nudge', 'conn', 'capture-open', 'update'] as const

contextBridge.exposeInMainWorld('tl', {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('tl', method, ...args),
  on: (channel: (typeof listeners)[number], cb: (payload: unknown) => void) => {
    if (!listeners.includes(channel)) throw new Error(`bad channel ${channel}`)
    const h = (_: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  },
  send: (channel: 'nudge-ready') => ipcRenderer.send(channel),
  platform: process.platform
})
