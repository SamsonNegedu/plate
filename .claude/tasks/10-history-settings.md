# Phase 9 — History, goals, and settings

Status: implemented; verification pending (Phase 8 code is in place)
Depends on: 8
Blocks: 10, 11

## Goal

Make the log legible over time and give the user control over goals, data, and sync. This is where the app stops being a logger and becomes a feedback loop.

## Design floor

`../design-parity.md` is the required matrix. The chart, stats, day list, and every settings panel must match or exceed the mockups in both themes, including empty, loading, offline, sync-paused, conflict, and error states. No simplified chart or unstyled form state.

## History

### Range and data

- Ranges: 7, 14, 30 days. Persist the last choice locally.
- Data from `GET /days?from=&to=` merged with local entries. The local view is authoritative while offline.
- Empty days are zero, not missing.
- The range always ends today.

### Chart specification

- A single-series bar chart of kcal per day. One y-axis; never a dual axis.
- Baseline at zero; bars anchored to it with 4 px rounded top corners only.
- 2 px gap between adjacent bars; no shadows, gradients, or decoration.
- Goal line: dashed 1 px in the secondary ink, labeled "goal 2,000" at the right, with a surface halo so it stays legible over a bar.
- Colors: accent green for under/at goal; red for over goal. Red is status, not a second series, and the tooltip/table state "over goal" in words.
- Direct label only on today's bar, plus the goal line. Never label every bar.
- X labels: every day for 7, every other day for 14, every fourth for 30, plus "today" on the last.
- Hover and keyboard focus show a tooltip with date, kcal, entry count, and over-goal status.
- Click or Enter on a bar opens `/today/:date`.
- Selected day gets a faint accent wash behind its slot.
- Table view toggle renders date, kcal, protein, carbs, fat, entries. This is the accessible alternative and is not optional.
- Dark mode uses the dark tokens; contrast is checked.

Recharts is allowed, but the mark specs above win over library defaults. If Recharts cannot meet them without fighting, render the chart with its primitives or plain SVG while keeping the same data contract.

### Stats

- Average kcal over days with at least one entry (do not count empty days as zero).
- Days logged in the range.
- Days over goal.
- 7-day average kcal, shown as a number, not a second line on the chart.
- A short "logged 12 of 14 days" line.

### Day list

Below the chart, reverse chronological rows: date, entry count, kcal (red when over), chevron. Tapping opens that day in Today.

### Empty states

- No entries in the range: a chart area with a baseline and the copy "No days logged yet. Start with today." plus a scan action.
- Some days logged: normal chart, empty days show no bar but remain hoverable.

## Goals and onboarding

### First run

A three-step, skippable onboarding:

1. Welcome: "Log what you eat by scanning the label." One primary action.
2. Daily goal: a number input prefilled with 2,000, plus an "Estimate for me" secondary path.
3. First scan tip: "Point the camera at a barcode. No barcode? Type it or add the label."

The estimate path uses Mifflin-St Jeor plus an activity factor and a deficit/surplus choice. It stores only the resulting goal and macro targets, not the body inputs. The user can skip and set the goal later.

### Goal form

- Calories: 500–9,000.
- Protein, carbs, fat: optional; 0 means not tracked.
- Day start hour: 0–23 for late-night logging.
- Save is explicit; dirty state is visible; errors inline.
- A hint explains that macros are optional and calories are the only required target.

## Settings

Sections:

1. **Goals**: calorie and macro targets, day start, save.
2. **Appearance**: Auto / Light / Dark segmented control, plus a "Scan feedback" toggle for sound and haptics.
3. **Sync**: state, last synced, pending count, conflicts count, "Sync now", "Log out all devices". A server kill switch shows "Sync paused by server"; logging continues locally.
4. **Foods and meals**: manage favorites, saved meals, and custom foods. Editing opens the same sheets used in logging; deleting a custom food never deletes historical entries.
5. **Your data**: export JSON, import JSON, delete all data.
6. **Storage**: estimated usage, "Keep data on this device" (requests persistent storage), a reminder to export.
7. **About**: version, data sources and licenses, source code link, privacy statement, "Copy diagnostics".

### Export

- `GET /export` returns a JSON file downloaded as `plate-backup-YYYY-MM-DD.json`.
- The file includes a schema version and app version.
- Export is available offline? The server is the source; if offline, export the local Dexie state as a rescue file with a clear "local only, may be incomplete" label. Provide both.

### Import

- File picker accepts JSON.
- Validate the schema version and shape before touching anything.
- Show a summary: entries, foods, saved meals, date range.
- Require an explicit "Replace all data" confirmation, not a plain button.
- The server writes a pre-import snapshot.
- After import, clear local Dexie tables, take a snapshot, and reload the app.
- Import is replace-only in v1; no merge.

### Delete all data

- Require typing the word DELETE.
- Deletes server data and local Dexie in that order.
- Clears the service worker cache and localStorage preferences.
- Signs out.
- Shows a final confirmation with the export option.

### Sync surface

- State pill: Offline, Syncing, Pending N, Error, Synced 2 min ago.
- Pending count from the outbox.
- Conflicts list: entity, time, server seq; read-only in v1.
- "Sync now" triggers a drain.
- A sync error shows the problem code and a retry action, not a raw stack.

## Diagnostics

"Copy diagnostics" copies a plain-text block:

- App version and build commit.
- Current route and theme.
- Online state, sync state, pending count, last sync error code.
- Entry, food, saved-meal, and favorite counts.
- Storage estimate and whether persistence was granted.
- Browser and platform user agent.

No product names, no food history, no identifiers, no session values. The button uses `navigator.clipboard.writeText` with a selection fallback and confirms with a toast.

## Install and platform affordances

- Android/Chrome: capture `beforeinstallprompt`, show an install button in Settings and a one-time banner after the first successful log.
- iOS: a short "Add to Home Screen" instruction sheet (Share → Add to Home Screen), shown once, dismissible.
- Detect `display-mode: standalone` and hide install prompts.
- Show the app version and build commit in About.

## Accessibility

- Chart has a table alternative and a text summary.
- Stats are a definition list with readable labels.
- Settings forms have labels, descriptions, and inline errors.
- The theme control is a radio group, not a toggle that loses the third option.
- Destructive actions are reachable but clearly marked.

## Tests

- Chart renders the correct number of bars for each range and treats zero days correctly.
- Goal line is at the right y position for different goals.
- Tooltip and keyboard focus expose the same data as the table.
- Over-goal bars are marked in the table and tooltip, not only in color.
- Average ignores empty days.
- Goal validation boundaries.
- Theme persists and applies before paint after reload.
- Export → import round-trip through the UI.
- Import rejects a bad file and changes nothing.
- Delete-all requires the typed confirmation.
- Sync status reflects pending, offline, error, and server-paused states.
- The chart is no worse than the mockup: bar geometry, goal line, labels, tooltip, table, dark mode.
- Settings has designed dirty, saved, error, import, and delete-confirmation states.
- Diagnostics copy contains no product names or identifiers.
- Favorites, saved meals, and custom foods can be managed from Settings.
- Install prompts appear only when appropriate.

## Acceptance

- The chart is readable in light and dark, at 400 px, with no label collisions.
- A screen reader can read the full history through the table.
- A user can change goals, export, import, and delete data without touching the API by hand.
- First run ends with a usable goal and a working scan action.
- Settings shows the true sync state after an offline session.

## Out of scope

Weight tracking, weekly budget modes, custom macro ratios, and CSV export.
