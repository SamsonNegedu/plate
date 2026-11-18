# Phase 7 — Frontend foundation

Status: done (2026-11-13). Verified with `make verify` and the shell parity pass below.
Depends on: 1, 4
Blocks: 8, 9

## Goal

The React PWA shell: design tokens ported from the approved mockups, routing, local Dexie schema, generated API client, auth screens, and an offline-capable first paint. No logging features yet.

## Source of truth

`../../mockups.html` is the visual reference. Do not extend the static prototype. Rebuild the same surfaces as React components with the same tokens, type scale, spacing, and interaction model.

`../design-parity.md` is the required screen/state matrix. Move the token block out of `mockups.html` into `web/src/styles/tokens.css` in this phase and link both. Build the shell to the mockup floor, not a simplified version, and design every shell state (offline, sync error, empty, loading).

## Stack

- React 19, TypeScript strict, Vite.
- React Router 7 in library mode.
- Dexie 4 + `dexie-react-hooks`.
- Zustand for ephemeral UI state (sheets, scanner, toasts).
- React Hook Form + Zod.
- Radix UI for dialog, toast, switch, and other primitives.
- Recharts for the history chart (Phase 9).
- MiniSearch for local food search (Phase 8).
- `barcode-detector` + `zxing-wasm` (Phase 8).
- `vite-plugin-pwa` (full offline behavior in Phase 10).
- `openapi-typescript` + `openapi-fetch` generated from Huma's OpenAPI.
- CSS Modules with a single global token file. No utility framework.
- Self-hosted Barlow and Barlow Condensed WOFF2 files.
- English only. All user-facing copy lives in `lib/copy.ts`; no i18n framework and no scattered literals. Dates and numbers use en-GB.

## Design tokens

Port exactly from the mockups:

| Token | Light | Dark |
|---|---|---|
| `--paper` / `--bg` | `#f4f5ef` | `#12150f` |
| `--surface` | `#ffffff` | `#1a1e17` |
| `--surface-2` | `#e9ecdf` | `#232920` |
| `--ink` | `#171a16` | `#ecefe4` |
| `--ink-2` | `#5a6155` | `#a6ad9d` |
| `--ink-3` | `#8c9385` | `#7c8475` |
| `--line` | `#d6dbcc` | `#2d3329` |
| `--accent` | `#2e6b4a` | `#6cba8c` |
| `--on-accent` | `#ffffff` | `#0e1712` |
| `--red` | `#ae352b` | `#e2796d` |
| `--amber` | `#b0731b` | `#dfa63d` |

Theme resolution: `auto`, `light`, `dark`. Persist in settings and apply before first paint with a small inline script that reads the cached theme from localStorage. No flash.

## Routes

| Route | Screen | Auth |
|---|---|---|
| `/login` | Login | public |
| `/` | Redirect to `/today` | protected |
| `/today` | Today, current date | protected |
| `/today/:date` | Today, specific date | protected |
| `/scan` | Scanner | protected |
| `/history` | History | protected |
| `/settings` | Settings | protected |

The tab bar has Today, Scan, History, Settings. It is hidden on `/login` and inside full-screen sheets. Unknown routes redirect to `/today`.

## App structure

```
web/src/
  app/
    App.tsx
    router.tsx
    providers.tsx
    AuthGate.tsx
    AppShell.tsx
  features/
    auth/
    today/
    scan/
    history/
    settings/
  db/
    schema.ts
    entries.ts
    foods.ts
    settings.ts
    savedMeals.ts
    favorites.ts
    outbox.ts
    meta.ts
  sync/
    engine.ts
    status.ts
    api.ts
  food/
    barcode.ts
    normalize.ts
    searchIndex.ts
  components/
    AppBar.tsx
    TabBar.tsx
    DayNav.tsx
    SummaryCard.tsx
    Meter.tsx
    MacroBar.tsx
    MealSection.tsx
    EntryRow.tsx
    Sheet.tsx
    Segmented.tsx
    Field.tsx
    Button.tsx
    Toast.tsx
    EmptyState.tsx
    OfflineBanner.tsx
    SyncBadge.tsx
  lib/
    api.ts
    copy.ts
    diagnostics.ts
    dates.ts
    numbers.ts
    errors.ts
  styles/
    tokens.css
    global.css
```

Feature folders own their components, hooks, and tests. Shared components are generic; no product logic in `components/`.

## Providers

- `ThemeProvider`: resolves auto/light/dark, updates `data-theme`, listens to `matchMedia`.
- `AuthProvider`: calls `/auth/me`. On 401, route to login. On a network failure, allow offline mode when local data exists and show "Offline, not verified"; sync pauses.
- `DatabaseProvider`: opens Dexie, runs migrations, exposes repositories.
- `SyncProvider`: starts/stops the sync engine, exposes status, pending count, conflicts.
- `ToastProvider`: Radix toast with a queue.
- `ErrorBoundary`: a readable recovery screen with reload and export actions.

## Auth screens

`/login`:

- Email and password fields.
- Inline error for 401; rate-limit message for 429.
- "Stay signed in" is implicit; the session is 30 days.
- No signup link.
- On success, navigate to the requested route or `/today`.

Offline login:

- If the app was previously used on this device and the network is down, show the local app with a persistent offline banner. Do not block reading or logging.
- When the session is confirmed invalid (401), require login; keep local data intact.

## Local database

Dexie schema v1 mirrors Phase 6. Indexes:

- `entries: id, eatenOn, meal, [eatenOn+meal], foodId, serverSeq, updatedAt, deletedAt`
- `foods: id, &barcode, searchName, source, serverSeq, deletedAt`
- `settings: userId`
- `savedMeals: id, serverSeq, deletedAt`
- `savedMealItems: id, savedMealId, foodId`
- `favorites: foodId`
- `foodPrefs: foodId` (local-only remembered unit and amount)
- `foodMisses: ++id, barcode, createdAt` (local-only coverage log)
- `outbox: ++id, opId, entity, entityId, status, nextAttemptAt`
- `meta: key`
- `conflicts: ++id, at, entity, entityId, serverSeq`

Repositories expose typed methods and never leak Dexie table objects into components. Live hooks: `useDay(date)`, `useSettings()`, `useRecentFoods()`, `useSavedMeals()`, `useFavorites()`, `useFoodPrefs()`, `useSyncStatus()`.

`foodPrefs` and `foodMisses` are local-only conveniences. They are never synced or exported by the server; a rescue export may include them for diagnostics.

## API client

- Generate types from `openapi.json` into `src/lib/api-types.ts`.
- `openapi-fetch` with `baseUrl: "/api/v1"`, `credentials: "include"`.
- A small wrapper maps problem+json to a typed `ApiError` with `code`, `detail`, `requestId`, and optional field errors.
- 401 triggers the auth flow once; it must not loop.
- Abort signals are passed through for search and lookups.

## Shell and empty states

- App bar: wordmark, theme button.
- Tab bar: four items, active indicator, safe-area padding.
- Today empty state: "Nothing logged yet. Scan a barcode or add food." with the two actions.
- History empty state: "Log a day to see it here."
- Settings shows sync state and version.

## Offline baseline

- The SPA shell is precached in Phase 10; in this phase, verify the app still renders from the Vite dev server and from the built binary.
- A visible offline banner is driven by failed requests and `online`/`offline` events.
- No route requires a network call to render; data comes from Dexie.

## Accessibility baseline

- 44×44 px minimum touch targets.
- Visible focus rings on every interactive element.
- Dialogs use Radix focus trapping and restore focus on close.
- Reduced motion respected globally.
- Labels are associated with inputs; errors use `aria-describedby`.
- The tab bar uses `aria-current="page"`.
- No color-only status; pair color with text.

## Tests

- Router guards: unauthenticated → login; authenticated → today.
- Login success and failure flows with MSW.
- Offline start renders local data and the banner.
- Theme resolution for auto/light/dark, including a persisted choice.
- Dexie schema migration from empty to v1.
- Repository CRUD with `fake-indexeddb`.
- App shell at 400 px has no horizontal scroll.
- Axe checks on login, empty today, and settings.

## Deliverables

- [x] Vite React TS app with strict config and CSS Modules.
- [x] Token file and self-hosted fonts.
- [x] Router, shell, tab bar, providers, error boundary.
- [x] Login and offline-start behavior.
- [x] Dexie schema and repositories.
- [x] Generated API types and typed client.
- [x] Shared components: Sheet, Segmented, Field, Button, Toast, EmptyState, OfflineBanner, SyncBadge.
- [x] Token file extracted from the mockups and linked from both.
- [x] Shell matches the design parity matrix at 320/400/560 and desktop, light and dark.
- [x] Component and unit tests.

## Verification note

`make verify` passes. Screenshots of `/login`, `/today`, `/history`, `/settings` and `/scan` were taken at 320, 400, 560 and 1440 px in light and dark: no horizontal overflow and no page errors. The two-column CTA and scan action rows now stack below 400 px, which removed the 320 px overflow found by this pass. Token values live only in `web/src/styles/tokens.css`; `mockups.html` links that file and no longer carries its own copy or CDN fonts. Phase 6's review pause remains a user sign-off item; it does not block this phase's completion.

## Acceptance

- Login works with the Phase 3 API; a wrong password shows an inline error.
- Every route renders without a network request after the first load.
- The shell matches the mockups at 400 px and desktop widths in both themes.
- Keyboard-only navigation reaches every control.
- `make build` produces a binary that serves the app with no console errors.
- `pnpm test` and `pnpm build` pass.

## Out of scope

Logging, scanning, search, charts, and the full service worker. This phase proves the shell.
