# Changelog

What changed in each Golau release, for the people using it. The release workflow publishes the section for each version as its release notes, so every version needs one here before it's tagged.

## 0.3.6

### New
- **Refresh, so Golau matches Azure DevOps.** Press **F5** (or Ctrl+R) anywhere to re-read your work and the open card from Azure DevOps, and the card panel has a refresh button of its own. Golau also refreshes when you switch back to its window, so a parent, state or title changed in Azure DevOps shows up without doing anything. Azure DevOps is always the source of truth.

### Fixed
- **A parent set in Azure DevOps now shows its title** in the card panel instead of just the number.
- **Narrow windows no longer overlap headers.** On cards and in the card panel a long type name such as "Product Backlog Item" is shortened with … instead of running over the card number and the Open in ADO button.

## 0.3.5

### New
- **Set, change or remove a card's parent.** The Parent row in the card panel now has *Add parent* / *Change* and a ✕ to remove it. The picker searches Azure DevOps for the parent, with type chips (Product Backlog Item, Feature, Epic and so on) and a *This project only* box (on by default; untick it to look across all projects). The chips start on the level Azure DevOps expects, one above the card; the others are dimmed but one tap away. The card itself and its current parent are left out. Changing a parent is one request, so if Azure DevOps refuses the link (wrong level, a loop) the old parent stays and you see why. Creating a card uses the same picker.

### Notes
- If the card already breaks a rule in your process (a required field is empty), re-parenting asks for the missing field first, like any other edit.

## 0.3.4

### Changed
- **The morning plan prompt stops at 10:30.** If you haven't planned by then, Golau stops asking for the day. Change the time in Settings → Your day ("Stop offering after").
- **No plan today means you're carrying on.** When you don't make a plan, Today shows your last plan with a "carried over from …" tag, and card picking, the wrap-up and "What are you working on?" use it too. Plan my day is still there whenever you want a fresh one.

- **Fewer, calmer nudges.**
  - Ignoring a nudge (letting it time out, or closing it with ✕) now makes that kind of nudge wait twice as long next time: "What are you working on?" goes 15 → 30 → 60 min and so on, up to 4 hours. Answering it resets the wait.
  - At least 20 minutes between any two nudges, so different kinds no longer stack up. Change it in Settings → Nudges. Coming back from being away still greets you straight away.
  - Every nudge now disappears on its own. Welcome back, the morning plan, the wrap-up and "Is there a card for this?" used to wait until you clicked.
  - "Still on this?" goes away after 45 seconds (was 90).

### Notes
- "Skip today" on the prompt still means no plan for today; nothing is carried over.
- A welcome-back that times out leaves your timer paused; nothing starts on its own.

## 0.3.3

### New
- **My work uses your team's ADO board columns.** The board now shows the same columns as your team's board in Azure DevOps (Stories / Backlog items / Issues, whichever your process uses), with ADO's names and order, instead of Golau's fixed four.
- **Cards sit where ADO has them**, even when two columns share a state (for example Dev and Test both "Active").
- **Dragging a card moves it on the real board:** Golau sets both the board column and the matching state, so a move from Dev to Test sticks in ADO too. A column with no state for that card's type refuses the drop.

### Notes
- Tasks (and anything else that isn't on that board) are placed by their state: new ones in the first column, active ones in the first in-progress column, closed ones in the last.
- Needs a team picked in Settings. Without one, or if the board can't be read, you get the previous four columns (To do / Doing / Review / Done).
- Boards with more than four columns scroll sideways.

## 0.3.2

### New
- **One-click open in Azure DevOps.** Every card on the board and in lists has an open icon (it shows when you point at the card), the focus bar has one for what you're working on, and the item panel has an **Open in ADO** button. Opens in your default browser; no more copying links.
- **ADO board button** on My work opens your team's board in the browser (the project's boards if no team is set).
- **Time Estimate field.** If your process has a "Time Estimate" field, the item panel shows it and you can edit it in place, and the new-card form offers it. Golau finds the field by its name, so it works whatever your process admin called it internally.

## 0.3.1

### New
- **Drag cards between columns** on My work. The column under the card lights up when it can go there, or shows red with a hint when that type has no state for it. When a column holds several states (e.g. Active / In Test), a small menu asks which.
- Moves show straight away and snap back if Azure DevOps refuses them; required-field prompts still appear.

## 0.3.0

### New
- **Built-in updates.** Golau checks GitHub for new releases, downloads the installer, checks it against the published SHA-256 checksums and upgrades in place. Settings → Updates: tell me (default), install automatically when you quit, or off; plus **Check now**.

## 0.2.2

### New
- **Required fields are handled.** The new-card form shows fields your process requires (and marks Description when it's required). If Azure DevOps rejects a change because of a rule (for example "Effort is required before Committed"), Golau asks for exactly those fields and retries, wherever the change came from.

## 0.2.1

### Fixed
- Board cards no longer spill into the next column with long titles or long state names, and the board goes from 4 to 2 to 1 columns as space runs out (also with the item panel open).

## 0.2.0

### Changed
- **Tasklight is now Golau** (Welsh for "light"). Your settings, token and history are copied over from Tasklight automatically on first start; nothing is deleted. Start with Windows is moved to the new app.

## 0.1.3

### Changed
- Ships as a per-user installer (`Tasklight-Setup-x.y.z.exe` at the time) instead of a zip: no admin prompt, Start menu shortcut, clean uninstall; settings are kept when you uninstall.
- Licensed GPL-3.0-or-later; Settings shows the version, license and source link.

## 0.1.2

### New
- First public build (as Tasklight, a zip you unpack and run): Azure DevOps work items with a focus timer, check-in nudges, unplanned-work capture, morning plan, stale-card review, end-of-day wrap-up, brain-dump inbox (Ctrl+Alt+Space), board, search, card creation, a floating focus bar and an optional BUSY Bar display.
