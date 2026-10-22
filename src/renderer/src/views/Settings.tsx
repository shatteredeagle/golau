import { useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'
import { call } from '../api'
import { useApp } from '../components'
import { ConnectionForm } from './Setup'
import { UpdateSettings } from '../update'

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function SettingsView(): ReactNode {
  const { settings, toast } = useApp()
  const [editConn, setEditConn] = useState(false)
  const [barKey, setBarKey] = useState('')
  const set = (patch: Partial<Settings>): void => void call('saveSettings', patch)

  const num = (key: keyof Settings, label: string, unit: string, min = 1, max = 600): ReactNode => (
    <label className="field">
      {label}
      <div className="row">
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          min={min}
          max={max}
          defaultValue={settings[key] as number}
          onBlur={(e) => {
            const v = Math.min(max, Math.max(min, Number(e.target.value) || min))
            if (v !== settings[key]) set({ [key]: v })
          }}
        />
        <span className="faint small">{unit}</span>
      </div>
    </label>
  )
  const time = (key: 'workStart' | 'workEnd' | 'eodTime' | 'morningPlanUntil', label: string): ReactNode => (
    <label className="field">
      {label}
      <input className="input" style={{ width: 130 }} type="time" value={settings[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  )
  const check = (key: keyof Settings, label: string, hint?: string): ReactNode => (
    <label className="check">
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <span className="faint small"> · {hint}</span>}
      </span>
    </label>
  )

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="settings">
        <div className="card">
          <h3>Azure DevOps</h3>
          {editConn ? (
            <ConnectionForm
              settings={settings}
              compact
              onDone={() => {
                setEditConn(false)
                toast('Connection saved')
              }}
            />
          ) : (
            <div className="row">
              <div className="stack" style={{ gap: 2 }}>
                <span>{settings.orgUrl}</span>
                <span className="muted small">
                  {settings.project}
                  {settings.team && ` · ${settings.team}`}
                </span>
              </div>
              <span className="spacer" />
              <button className="btn" onClick={() => setEditConn(true)}>
                Change
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Your day</h3>
          <div className="stack">
            <label className="field">
              Work days
              <div className="days">
                {DAYS.map((d, i) => (
                  <button
                    key={i}
                    className={settings.workDays.includes(i) ? 'on' : ''}
                    onClick={() => set({ workDays: settings.workDays.includes(i) ? settings.workDays.filter((x) => x !== i) : [...settings.workDays, i].sort() })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </label>
            <div className="row wrap" style={{ gap: 18 }}>
              {time('workStart', 'Start')}
              {time('workEnd', 'End')}
              {time('eodTime', 'Wrap-up reminder')}
            </div>
            <div className="row wrap" style={{ gap: 18, alignItems: 'flex-end' }}>
              {check('morningPlan', 'Offer a morning plan', 'first time you\'re active on a work day')}
              {settings.morningPlan && time('morningPlanUntil', 'Stop offering after')}
            </div>
            <div className="faint small">Didn't plan? Golau keeps yesterday's plan going; you can still plan any time from Today.</div>
            {check('eodCheckIn', 'Offer an end-of-day wrap up')}
            <div className="faint small">Nudges only happen inside these hours. Outside them Golau still tracks time but stays quiet.</div>
          </div>
        </div>

        <div className="card">
          <h3>Nudges</h3>
          <div className="stack">
            <div className="row">
              {check('nudgesEnabled', 'Nudges on')}
              <span className="spacer" />
              <button className="btn sm" onClick={() => void call('testNudge')}>
                Show a test nudge
              </button>
            </div>
            <div className="grid2">
              {num('checkInMinutes', '"Still on this?" every', 'minutes', 10, 240)}
              {num('noFocusMinutes', 'Ask what you\'re on after', 'minutes with nothing tracked', 5, 240)}
              {num('unplannedAskMinutes', 'Ask "is there a card?" after', 'minutes of unplanned work', 5, 240)}
              {num('hyperfocusMinutes', 'Suggest a break after', 'minutes straight', 30, 480)}
              {num('staleDays', 'Card counts as quiet after', 'days without changes', 1, 60)}
              {num('idleMinutes', 'Pause the timer when away for', 'minutes', 2, 120)}
              {num('nudgeGapMinutes', 'At least this long between nudges', 'minutes', 0, 240)}
            </div>
            <div className="faint small">
              Every nudge has a no-guilt "later" and disappears on its own. Ignoring one (or closing it with ✕) makes that kind wait twice as long next time; answering it resets that. The tray menu has "Quiet for…" for focus blocks and meetings.
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Focus bar & shortcuts</h3>
          <div className="stack">
            {check('showMini', 'Show the floating focus bar while a timer runs', 'drag it anywhere')}
            <label className="field">
              Quick capture hotkey
              <input
                className="input"
                style={{ width: 280 }}
                defaultValue={settings.captureHotkey}
                onBlur={(e) => e.target.value !== settings.captureHotkey && set({ captureHotkey: e.target.value.trim() })}
              />
              <span className="faint small">Electron accelerator format, e.g. CommandOrControl+Alt+Space or CommandOrControl+Shift+J</span>
            </label>
            {check('launchAtLogin', 'Start with Windows', 'opens minimized to the tray')}
            {check('closeToTray', 'Closing the window keeps Golau running in the tray')}
            {check('logCompletedWork', 'Wrap up pre-ticks "log hours to Completed Work"', 'for Tasks that track hours')}
            <label className="field">
              Theme
              <div className="seg" style={{ width: 'fit-content' }}>
                {(['system', 'dark', 'light'] as const).map((t) => (
                  <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
                    {t}
                  </button>
                ))}
              </div>
            </label>
          </div>
        </div>

        <div className="card">
          <h3>BUSY Bar</h3>
          <div className="stack">
            <div className="faint small">
              Shows the card you're on and the timer on the Bar's front display. Home Assistant's meeting text still wins while you're in a call.
            </div>
            <label className="check">
              <input type="checkbox" checked={settings.busybar.enabled} onChange={(e) => set({ busybar: { ...settings.busybar, enabled: e.target.checked } })} />
              Send focus to the BUSY Bar
            </label>
            <div className="grid2">
              <label className="field">
                Bar address
                <input
                  className="input"
                  defaultValue={settings.busybar.host}
                  placeholder="busybar.lan or 192.168.x.x"
                  onBlur={(e) => e.target.value.trim() !== settings.busybar.host && set({ busybar: { ...settings.busybar, host: e.target.value.trim() } })}
                />
              </label>
              <label className="field">
                Access PIN {settings.busybar.hasKey && <span className="faint">(saved)</span>}
                <div className="row">
                  <input className="input" type="password" value={barKey} placeholder={settings.busybar.hasKey ? '••••' : 'only if the Bar has one'} onChange={(e) => setBarKey(e.target.value)} />
                  <button
                    className="btn sm"
                    disabled={!barKey}
                    onClick={() => void call('setBusybarKey', barKey).then(() => { setBarKey(''); toast('PIN saved') })}
                  >
                    Save
                  </button>
                </div>
              </label>
              <label className="field">
                Priority (1–100)
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={settings.busybar.priority}
                  onBlur={(e) => set({ busybar: { ...settings.busybar, priority: Math.min(100, Math.max(1, Number(e.target.value) || 40)) } })}
                />
              </label>
            </div>
            <div className="row">
              <button
                className="btn"
                disabled={!settings.busybar.host}
                onClick={() =>
                  void call('testBusybar')
                    .then(() => toast('Sent. Check the Bar.'))
                    .catch((e: Error) => toast(e.message, { error: true }))
                }
              >
                Send test message
              </button>
              <button className="btn ghost" disabled={!settings.busybar.host} onClick={() => void call('clearBusybar').then(() => toast('Cleared'))}>
                Clear the Bar
              </button>
            </div>
          </div>
        </div>

        <UpdateSettings mode={settings.updates} onMode={(m) => set({ updates: m })} />

        <About />
      </div>
    </>
  )
}

/** GPL-3.0 §5(d): interactive programs show the license, the lack of warranty and where the source is. */
function About(): ReactNode {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void call('appVersion').then(setVersion)
  }, [])
  const source = 'https://github.com/shatteredeagle/golau'
  return (
    <div className="faint small" style={{ padding: '0 4px 10px' }}>
      Golau {version} · Copyright © 2026 shatteredeagle · Free software under the{' '}
      <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU GPL v3 or later</a>, with no warranty. Source code:{' '}
      <a href={source}>{source.replace('https://', '')}</a>
    </div>
  )
}
