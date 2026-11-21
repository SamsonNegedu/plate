# The web client

React 19 and TypeScript (strict), built with Vite, installed as a PWA. Code in `web/src`; the `@/` import alias points there.

## Structure

| Folder | Holds |
|---|---|
| `app/` | providers (database, auth, sync, theme), the shell and tab bar, the router, the error boundary, the update prompt, storage guards |
| `db/` | the Dexie schema, and the only code that writes entries, foods, favorites, saved meals, settings and the outbox |
| `sync/` | the engine, the HTTP transport, wire parsing, and the status store ([sync.md](sync.md)) |
| `food/` | barcode detection, the camera hook, the lookup flow, the local search index |
| `features/` | one folder per screen: `today`, `scan`, `recipes`, `health`, `history`, `settings`, `auth`, and the `log` sheets (search, product, quick add, manual food, entry edit, recipe portions, nutrition table, save as recipe) |
| `components/` | shared UI: Sheet, Button, Field, Select, Segmented, SummaryCard, Meter, MacroBar, EntryRow, TabBar, ToastHost, SyncBadge, and others |
| `styles/` | `tokens.css` (the design tokens) and `global.css` (the Tailwind theme and base rules) |
| `lib/` | dates, numbers, nutrition math, search-name folding, `copy.ts` (all English text), `useNow`, `cn`, the API client |
| `api/schema.d.ts` | generated from the OpenAPI spec; never edited by hand |

Providers wrap the app in this order: error boundary, database, auth, sync, theme. Routes are `/login`, `/signup` and `/reset` (signed out), then behind the auth gate `/today`, `/today/:date`, `/scan`, `/recipes`, `/recipes/new`, `/recipes/:id`, `/health`, `/health/:tab`, `/history`, `/settings` and `/settings/:section`. The bottom tab bar is Today, Scan, Recipes, Health, History and Settings. Settings is a short home (quick toggles plus one row per group with its state on the right); `goals`, `account`, `sync`, `foods`, `data` and `about` each open on their own page, and an unknown section returns to the home. Scan, recipes, health, history and settings load lazily; sheets, forms and toasts load as one chunk after the first tap.

## Data and state

- **Persistent data lives only in Dexie** (IndexedDB) and is read with live queries (`dexie-react-hooks`), so every tab and screen updates when a row changes. No app data is kept in `localStorage`.
- **Zustand holds ephemeral UI state only**: the stack of open sheets and the toasts (`lib/ui.ts`).
- **Forms** use React Hook Form with Zod schemas (`features/log/schemas.ts`); Zod also validates server data before it is used.
- **Server data** is fetched with `openapi-fetch` using the generated types, and every response is parsed before use.

### State machines

Flows with several steps are explicit discriminated unions with pure reducers, each unit-tested, so impossible combinations cannot be represented:

| Machine | File | States |
|---|---|---|
| Scan page | `features/scan/scanMachine.ts` | input: `camera` or `typing` (with its text and error); lookup: `idle` or `running`; detector: `loading`, `ready`, `failed`. The camera runs only while the input is the camera and no lookup is running |
| Data panel | `features/settings/dataMachine.ts` | restore: `idle`, `confirming`, `restoring`; wipe: `idle`, `confirming` (typed text), `wiping`; plus the last problem |
| Auth | `app/auth.tsx` | `loading`, `authed` (username, offline), `anon` (offline), `access` (a proxy asks to sign in again) |
| Camera | `food/camera.ts` | derived rather than stored: `idle` while paused, a support problem (`insecure`, `unsupported`), or the outcome of the last start (`starting`, `active`, `denied`, `no-camera`, `busy`) |
| Sync | `sync/status.ts` | `idle`, `syncing`, `offline`, `error`, `auth`, `paused`, `access` |

Time is read through `useNow()`, which refreshes each minute and when the app returns to the foreground, so "today" rolls over at midnight and render stays pure.

## Offline and the PWA

- The service worker (`sw.ts`, Workbox `injectManifest`) precaches the shell, fonts, icons and the scanner's WASM decoder, so the app opens with no network. Client routes are served the precached shell; `offline.html` is the last resort when even the shell is missing.
- Product images are cache-first (300 entries, 60 days). `/api/` calls are network-only and never cached.
- Updates are prompted, not automatic. The "new version" prompt appears only when reloading is safe: not on the scanner, not behind a sheet, and nothing waiting to send.
- The app asks the browser for persistent storage and shows a banner with an export action if a write hits the quota.
- An install prompt appears where the browser supports one, with instructions for iOS Safari.

## History

History reads the chosen range (plus the six days before it) from Dexie and derives everything on the device in `features/history/stats.ts`; nothing is sent to the server.

- **Chart:** one nutrient per day (calories, protein, carbs, fat, fibre, sugar, saturated fat or salt), with a 7-day average line. Calories draw red when over the goal; every other nutrient is a target with no red. A nutrient with no goal (fibre, sugar, saturated fat, salt, or a macro set to zero) draws without a goal line and shows its highest day instead of a goal count. The average uses only logged days and the line breaks where a window has none. An unlogged day, or a day where no entry reports protein, is a gap, never a zero. A day with some protein-less entries is marked as partly reported.
- **Pattern note:** names up to two weekdays that run at least 150 kcal (or 10%) above the average. It needs 10 logged days and 2 per weekday, otherwise it stays hidden.
- **Day rows** open in place to show kcal per meal and the three biggest entries with their share of the day.
- **Top foods** groups entries by food (else name and brand) and shows the five that supply the most calories. It sits above the days list, which shows a week at first and grows with "Show more days".
- **Reading the chart:** a title above it says what the axis counts ("Fat, g a day"). Calories, protein, carbs and fat are one tap; the rest are in a "More" menu that shows the pick. Under the chart a small mark is a dose day. The caption under it reserves the height of its longer text, so focusing a bar never moves the page.
- **In the address:** `?range=7|14|30` and `?metric=...`, so a view can be linked and survives a reload. Without them the last range used (kept as a small preference) and calories apply.

## Recipes

A recipe is a saved meal with a portion count. Its tab (`/recipes`) lists them with calories a portion; `/recipes/new` and `/recipes/:id` are one editor.

- **Nutrition without a cooked weight.** Ingredients keep the grams you put in. The recipe's nutrition per 100 g is measured against their combined weight, and one portion weighs that total over `servings`. Calories do not change when food cooks, so a portion, a fraction of one, or any number of them comes out exact (`lib/recipe.ts`). A nutrient only some ingredients report is shown as a minimum; one none report stays empty, never 0.
- **Logging.** A recipe is logged as one entry named after it, in portions (1, ½, 2, or any amount), with the recipe's nutrition snapshotted onto the entry. Editing the recipe later never rewrites entries already logged.
- **Ingredients** come from the same food bank as logging: the search sheet in pick mode (recents, favorites, your foods, the catalog, Open Food Facts through the server) and the scanner, opened as `/scan?recipe=<id|new>`. The unsaved recipe is parked in memory while the scanner runs and restored on return.
- **Sharing.** "Share recipe" sends a copy, not a link: a small JSON file (`*.plate-recipe.json`) and a readable text version, through the device's share menu, a saved file, or the clipboard. Ids and food links are left out, so nothing of the sender's account travels. "Import" on the Recipes page reads a file or pasted data, validates every field with the same limits the server enforces, shows what it is, and adds it as the person's own recipe. There are no invites, no hosted links and no shared recipes: each account stays isolated and nothing syncs between them. The format is versioned (`plate-recipe`, version 1).
- **Sample data.** Development builds show "Load sample data" under Settings, Your data: five recipes and about a month of history, marked with a note so "Remove sample data" deletes only them.

## Weight and medication

`/health` ("Body and medication", reached from a Settings row and from the Today reminder) holds weight and waist, an optional medication plan, how the person feels, and what their own logs show. Everything is a `health_record` row (see the data model) except the plan and the weight goal, which are optional fields on settings. Saving goals merges over the existing settings, so it never clears the plan.

- **Tabs:** Weight, Medication and Insights are in the address (`/health/weight`, `/health/medication`, `/health/insights`); a bare `/health` opens Medication for someone with a plan and Weight otherwise.
- **Weight** shows the latest weighing, labelled figures for where it started, the change and the goal (tap the goal to change it), a progress bar with "kg to go", and a chart of daily dots with a 7-day average line. The readings table is inside the chart card. One button, "Log a measurement", logs weight or any body measurement.
- **Measurements** (waist, hips, chest, upper arm, thigh, neck, in cm) are listed only once logged, each with its latest value and the change since its first reading; tapping a row logs another.
- **Medication** starts from a list of products (`lib/pens.ts`: Wegovy, Ozempic, Mounjaro, Zepbound, Trulicity, Bydureon, Saxenda, Victoza, Rybelsus) with their generic name, usual interval and strengths, or "Other" for a name of the person's own. The strengths are shortcuts on the dose sheet, not limits, because they differ by country. The card shows the next dose due (with the amount you are on), the schedule, the last dose and the doses left, with a refill note at one or none. "Change medication" switches to another pen and keeps every earlier dose in the list, which then names the medication. A dose is edited or deleted from the list and the delete offers Undo.
- **How you feel** is two taps a day, appetite and nausea, 0 to 5.
- **Insights** are the person's own data only: a column chart of average calories by days since the last dose (for the medication chosen, saved as `?med=`), intake before and since the start, and protein for the current weight. With two or more medications the before-and-since table becomes a table by medication (before any dose, then each one, from its first dose), and a stretch with fewer than three logged days is left out. Everything stays hidden until there are enough logged days. The app never suggests or judges a dose.
- **Reminders** are one line on Today for someone who uses this: a dose due or overdue, or no weight for a week. There are no push notifications; a PWA cannot send them reliably and web push needs a push service.

## Goals

`/settings/goals` holds calories, the macro targets, a fibre target and the day-start hour. Macros are stored as grams but can be entered as grams or as a share of the calories (`features/settings/MacroTargets.tsx`, `lib/macros.ts`): each field shows the other unit under it, a bar shows how much of the calorie goal the macros cover (protein and carbs 4 kcal a gram, fat 9), and a line says how far they are from the goal, within 5% counting as a match. Fibre has a target of its own and is not part of the macro calories. A target left blank is not tracked. Saving goals keeps the weight goal and the medication plan.

## Today's totals

The big number on Today is the calories eaten, with "left of goal" or "over your goal" on one line under it. The summary ("All nutrients") and each meal heading with entries open one nutrition table with tabs for the day and each meal. The day shows every nutrient against its goal; a meal shows each nutrient's share of the day. A nutrient no food reports shows a dash, and one only some foods report is marked as a minimum.

## Sample data

In a development build only (`import.meta.env.DEV`), Settings, Your data offers "Load sample data": six recipes from REWE and Lidl style staples, 27 foods, a month of history, and a fortnight of weight, measurements, weekly doses and ratings, all marked so "Remove sample data" deletes only them. The code is behind a build-time constant, so a production build does not contain it.

## Scanning

`food/barcode.ts` uses the native `BarcodeDetector` when it exists and a WASM decoder (`barcode-detector` with `zxing-wasm`, self-hosted) otherwise. `food/camera.ts` owns the stream: it runs only while the page is visible and the scan page wants it, and always stops its tracks on cleanup. A photo upload, a typed barcode and manual entry are always available, so scanning is never the only way in. Camera access needs HTTPS (localhost excepted).

## Adding a product and reading a label

A barcode no source knows opens the not-found sheet: **Scan the nutrition label** or **Type it in**. Both end in the same label-style table (`features/log/NutritionFields.tsx`, built from `components/NutrientRow.tsx`), in the order of a printed label. Quick add uses the same table for a whole plate, so the kcal/kJ switch, the "check" marks and the hint that numbers do not add up are the same everywhere. Saving a food that has a barcode calls `food/corrections.ts`: online it goes live for every account at once when the numbers pass the plausibility checks (`lib/plausibility.ts`, the same rules as the server); a failed check keeps a private copy and names the check. Offline, the person gets a private copy to log with, and the correction waits in the device-only `corrections` table and is sent when the app opens or the connection returns. A food without a barcode stays private.

The label reader (`food/ocr/`) is a convenience, never a requirement. It reads the photo on the device with PP-OCRv4 through ONNX Runtime WebAssembly: `engine.ts` runs the detector and recognizer, `parse.ts` turns the lines into per-100 g values, `scan.ts` prepares the photo. The parser never reads a per-serving column as per 100 g, leaves an unread value blank instead of 0, and marks values it cannot settle with the label's own arithmetic as "check". The files (18 MB compressed, 30 MB unpacked) live in `public/ocr/` (stored gzipped in a build and sent with `Content-Encoding: gzip` by `internal/webui`), are copied by `scripts/copy-wasm.mjs`, are fetched the first time someone scans a label and kept by the service worker (`plate-ocr`); they are not precached. The first scan says it is downloading. The photo never leaves the device.

## Styling

Tailwind CSS v4, themed from the CSS variables in `styles/tokens.css`. `@theme inline` in `styles/global.css` maps each token to a utility (`bg-surface`, `text-ink-2`, `border-line`, `rounded-card`), so light, dark and the `data-theme` override all switch through the variables and no `dark:` variant is used. `tokens.css` is also what `mockups.html` links, so there is one set of values.

- Type is a named scale: `text-micro`, `caption`, `meta`, `label`, `body`, `input`, `section`, `heading`, `title`, `wordmark`, `stat`, `total`, `display`, with matching `leading-*` and `tracking-display`. Use these, not pixel values.
- Use `cn()` (`lib/cn.ts`) to combine classes. The formatter sorts them.
- No arbitrary colors. Patterns that repeat across files live in a component or a small shared constant (see `features/settings/ui.ts`).
- Reduced motion is honored globally.

## Tests and tooling

| Command | What it does |
|---|---|
| `pnpm test` | Vitest and Testing Library: reducers, db, sync engine and convergence, lookup, forms |
| `pnpm lint` | oxlint (correctness plus React rules: hooks, purity, no nested ternaries, no index keys) and `oxfmt --check` |
| `pnpm fmt` | oxfmt (formats code, sorts Tailwind classes and imports) |
| `pnpm typecheck` | `tsc` for the app and the service worker |
| `pnpm test:visual` | pixel baselines at 400 px, light and dark (macOS renders; run locally, needs a fresh server) |
| `make test-e2e` | Playwright against the real binary: logging, recipes and sharing, health, scan with a fake camera, offline, settings, accessibility |

The conventions the repo enforces are in `CLAUDE.md` and `.claude/skills/react-pwa`.
