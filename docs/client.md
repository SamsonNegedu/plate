# The web client

React 19 and TypeScript (strict), built with Vite, installed as a PWA. Code in `web/src`; the `@/` import alias points there.

## Structure

| Folder | Holds |
|---|---|
| `app/` | providers (database, auth, sync, theme), the shell and tab bar, the router, the error boundary, the update prompt, storage guards |
| `db/` | the Dexie schema, and the only code that writes entries, foods, favorites, saved meals, settings and the outbox |
| `sync/` | the engine, the HTTP transport, wire parsing, and the status store ([sync.md](sync.md)) |
| `food/` | barcode detection, the camera hook, the lookup flow, the local search index |
| `features/` | one folder per screen: `today`, `scan`, `history`, `settings`, `auth`, and the `log` sheets (search, product, quick add, manual food, entry edit, save meal) |
| `components/` | shared UI: Sheet, Button, Field, Segmented, SummaryCard, Meter, MacroBar, EntryRow, TabBar, ToastHost, SyncBadge, and others |
| `styles/` | `tokens.css` (the design tokens) and `global.css` (the Tailwind theme and base rules) |
| `lib/` | dates, numbers, nutrition math, search-name folding, `copy.ts` (all English text), `useNow`, `cn`, the API client |
| `api/schema.d.ts` | generated from the OpenAPI spec; never edited by hand |

Providers wrap the app in this order: error boundary, database, auth, sync, theme. Routes are `/login`, then behind the auth gate `/today`, `/today/:date`, `/scan`, `/history` and `/settings`. Scan, history and settings load lazily; sheets, forms and toasts load as one chunk after the first tap.

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
| Auth | `app/auth.tsx` | `loading`, `authed` (email, offline), `anon` (offline), `access` (a proxy asks to sign in again) |
| Camera | `food/camera.ts` | derived rather than stored: `idle` while paused, a support problem (`insecure`, `unsupported`), or the outcome of the last start (`starting`, `active`, `denied`, `no-camera`, `busy`) |
| Sync | `sync/status.ts` | `idle`, `syncing`, `offline`, `error`, `auth`, `paused`, `access` |

Time is read through `useNow()`, which refreshes each minute and when the app returns to the foreground, so "today" rolls over at midnight and render stays pure.

## Offline and the PWA

- The service worker (`sw.ts`, Workbox `injectManifest`) precaches the shell, fonts, icons and the scanner's WASM decoder, so the app opens with no network. Client routes are served the precached shell; `offline.html` is the last resort when even the shell is missing.
- Product images are cache-first (300 entries, 60 days). `/api/` calls are network-only and never cached.
- Updates are prompted, not automatic. The "new version" prompt appears only when reloading is safe: not on the scanner, not behind a sheet, and nothing waiting to send.
- The app asks the browser for persistent storage and shows a banner with an export action if a write hits the quota.
- An install prompt appears where the browser supports one, with instructions for iOS Safari.

## Scanning

`food/barcode.ts` uses the native `BarcodeDetector` when it exists and a WASM decoder (`barcode-detector` with `zxing-wasm`, self-hosted) otherwise. `food/camera.ts` owns the stream: it runs only while the page is visible and the scan page wants it, and always stops its tracks on cleanup. A photo upload, a typed barcode and manual entry are always available, so scanning is never the only way in. Camera access needs HTTPS (localhost excepted).

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
| `make test-e2e` | Playwright against the real binary: logging, scan with a fake camera, offline, settings, accessibility |

The conventions the repo enforces are in `CLAUDE.md` and `.claude/skills/react-pwa`.
