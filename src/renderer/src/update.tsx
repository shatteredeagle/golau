import { useEffect, useState, type ReactNode } from 'react'
import { Download, Loader2, RefreshCw, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { call, on } from './api'

export function useUpdate(): UpdateStatus | null {
  const [s, set] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void call('updateStatus').then(set)
    return on<UpdateStatus>('update', set)
  }, [])
  return s
}

/** Slim bar under the focus bar when there's an update to act on. Dismissable per version. */
export function UpdateBanner(): ReactNode {
  const u = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!u || !u.latest || dismissed === u.latest) return null
  if (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'ready') return null
  return (
    <div className="update-banner">
      {u.state === 'available' && (
        <>
          <Download size={15} />
          <span>
            Golau <b>{u.latest}</b> is available (you have {u.current}).
          </span>
          <button className="btn sm primary" onClick={() => void call('downloadUpdate')}>
            Update now
          </button>
          {u.pageUrl && (
            <button className="btn sm ghost" onClick={() => void call('openExternal', u.pageUrl!)}>
              What's new
            </button>
          )}
        </>
      )}
      {u.state === 'downloading' && (
        <>
          <Loader2 size={15} className="spin" />
          <span>Downloading Golau {u.latest}… {u.progress ?? 0}%</span>
          <span className="update-progress">
            <i style={{ width: `${u.progress ?? 0}%` }} />
          </span>
        </>
      )}
      {u.state === 'ready' && (
        <>
          <RefreshCw size={15} />
          <span>Golau {u.latest} is ready. Restarting takes a few seconds; your timer and notes are kept.</span>
          <button className="btn sm primary" onClick={() => void call('installUpdate')}>
            Restart to update
          </button>
        </>
      )}
      <span className="spacer" />
      <button className="icon-btn" title="Hide until the next version" onClick={() => setDismissed(u.latest!)}>
        <X size={15} />
      </button>
    </div>
  )
}

const ago = (t?: number): string => {
  if (!t) return 'never'
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Settings → Updates */
export function UpdateSettings({ mode, onMode }: { mode: 'off' | 'notify' | 'auto'; onMode: (m: 'off' | 'notify' | 'auto') => void }): ReactNode {
  const u = useUpdate()
  const [info, setInfo] = useState<{ packaged: boolean; platform: string } | null>(null)
  useEffect(() => {
    void call('appVersionInfo').then(setInfo)
  }, [])
  const busy = u?.state === 'checking' || u?.state === 'downloading'
  const line = !u
    ? ''
    : u.state === 'checking'
      ? 'Checking…'
      : u.state === 'up-to-date'
        ? `You're up to date (${u.current}). Checked ${ago(u.checkedAt)}.`
        : u.state === 'available'
          ? `Golau ${u.latest} is available.`
          : u.state === 'downloading'
            ? `Downloading ${u.latest}… ${u.progress ?? 0}%`
            : u.state === 'ready'
              ? `Golau ${u.latest} is downloaded and ready to install.`
              : u.state === 'error'
                ? u.error ?? 'Update check failed.'
                : `Version ${u.current}.`
  return (
    <div className="card">
      <h3>Updates</h3>
      <div className="stack">
        <div className="seg" style={{ width: 'fit-content' }}>
          {(
            [
              ['notify', 'Tell me'],
              ['auto', 'Install automatically'],
              ['off', 'Off']
            ] as const
          ).map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="faint small">
          {mode === 'notify' && 'Checks GitHub every few hours and shows a banner when there is a new version.'}
          {mode === 'auto' && 'Downloads new versions in the background and installs them when you quit Golau (or when you click Restart).'}
          {mode === 'off' && 'No automatic checks. You can still check by hand.'}{' '}
          Updates come only from this project's GitHub releases, are checked against the release's SHA-256 checksum, and install just for you (no admin).
        </div>
        <div className="row wrap">
          <span className={u?.state === 'error' ? 'error' : 'muted'} style={{ padding: u?.state === 'error' ? undefined : 0 }}>
            {line}
          </span>
          <span className="spacer" />
          {u?.state === 'available' && (
            <button className="btn sm primary" onClick={() => void call('downloadUpdate')}>
              Download {u.latest}
            </button>
          )}
          {u?.state === 'ready' && (
            <button className="btn sm primary" disabled={!info?.packaged || info.platform !== 'win32'} onClick={() => void call('installUpdate')}>
              Restart to update
            </button>
          )}
          <button className="btn sm" disabled={busy} onClick={() => void call('checkForUpdates')}>
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Check now
          </button>
        </div>
      </div>
    </div>
  )
}
