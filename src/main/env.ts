import { app } from 'electron'

/** True only when running from source (npm run dev / shots), never in the packaged exe. */
export const DEV = !app.isPackaged

/**
 * Dev/test switches (TASKLIGHT_*, ELECTRON_RENDERER_URL). Ignored in the packaged app so an
 * environment variable can't point it at a remote page, a fake token or another data folder.
 */
export function devEnv(name: string): string | undefined {
  return DEV ? process.env[name] : undefined
}
