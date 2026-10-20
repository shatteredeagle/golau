# Tasklight

A desktop companion for Azure DevOps boards, built for an ADHD brain: it keeps one card "in focus", times it, nudges gently, and makes keeping cards updated a 3-minute habit instead of a chore.

Runs locally (Electron). Windows is the main target; Linux works too. Your PAT is encrypted with the OS keystore (DPAPI on Windows) and only ever talks to `dev.azure.com`.

## Install (Windows)

1. Unzip `Tasklight-<version>-win.zip` anywhere (e.g. `%LOCALAPPDATA%\Tasklight`). No installer, no admin.
2. Run `Tasklight.exe`. SmartScreen may warn because it's unsigned: **More info → Run anyway**.
3. Paste your org URL + a PAT with **Work Items: Read & write** (+ **Project and Team: Read** to pick a team).

Settings → *Start with Windows* makes it launch to the tray at login.

## What it does

| | |
|---|---|
| **Focus** | One card at a time, big timer, "where I left off" note that greets you when you come back. Floating always-on-top focus bar. |
| **Unplanned work** | Just type what you're doing. After 20 min it asks (once) if there's a card for it, with suggestions. Link it, make one, or say no card needed; time moves to the card. |
| **Check-ins** | "Still on this?" every 45 min, auto-dismisses as *yes*. Nothing tracked for 15 min while you're active? It asks what you're on. |
| **Morning plan** | Pick 1–3 cards that would make today a win; yesterday's leftovers come pre-ticked. |
| **Gone quiet** | Cards in progress with no changes for 3+ days: one-click *still on it / back to to-do / done*. |
| **Wrap up** | End of day, card by card: state, a quick update (chips for common ones), log hours, a note for tomorrow-you. Then sort the unplanned stuff. |
| **Away / breaks** | Timer pauses on idle, lock or sleep, and asks to resume when you're back. Suggests a break after 90 min straight. |
| **Brain dump** | `Ctrl+Alt+Space` anywhere: Enter parks a thought in the inbox, Ctrl+Enter starts tracking it. |
| **Board, search, create** | My work as columns with inline state changes; search everything (title/#id, type, state, assignee, all projects); create items with parent, tags, sprint, estimate. |
| **BUSY Bar** | Optional: shows the focused card + timer on the Bar's front display (priority below Home Assistant so meeting text wins). |

Nudges only fire in your work hours, never while you're idle, one at a time, and every one has a no-guilt "later". Tray → *Quiet for…* silences them for a focus block.

Keys: `Ctrl+K` switch task · `Ctrl+N` new item · `/` search · `Esc` close.

## Develop

```bash
npm ci && node node_modules/electron/install.js   # npm 12 blocks Electron's postinstall
npm run mock     # fake ADO at http://localhost:7071/mockorg (project Platform), any PAT
npm run dev      # app with hot reload
npm test         # nudge-rule tests (fake clock)
npm run shots    # renders every screen offscreen to .shots/*.png (needs the mock running)
npm run dist:win # dist/Tasklight-<version>-win.zip (builds from Linux; rcedit runs under wine)
```

Data lives in `%APPDATA%\Tasklight` (`settings.json`, `state.json`, `secrets.bin`). Override with `TASKLIGHT_DATA`.

### Layout

- `src/main/ado.ts`: Azure DevOps REST client (WIQL, batch, comments, create, update)
- `src/main/tracker.ts`: the local journal: focus, sessions, unplanned work, inbox, plans
- `src/main/scheduler.ts`: when to nudge (tested in `test/scheduler.test.mts`)
- `src/main/busybar.ts`: BUSY Bar display
- `src/renderer/src/views/*`: screens; `surfaces.tsx`: nudge card, focus bar, capture box
