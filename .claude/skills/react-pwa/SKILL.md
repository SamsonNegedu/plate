---
name: react-pwa
description: Use when writing or reviewing React, TypeScript, Dexie, routing, forms, scanner, or PWA code in Plate. Enforces the offline-first data model, component boundaries, accessibility, and performance rules.
---

# React PWA guardrails

## Data model

- Dexie is the local source of truth for entries, foods, settings, saved meals, favorites, and the outbox.
- Components read through repository hooks (`useDay`, `useSettings`, `useRecentFoods`), never directly from a Dexie table.
- No TanStack Query, Redux, MobX, or SWR. No app data in `localStorage`; only small UI preferences such as theme and history range.
- Zustand is for ephemeral UI state only: open sheet, scanner status, toast queue, selected date while a sheet is open. Not for persisted rows.
- A catalog hit is fully loggable and must not trigger an OFF request. Search results always have kcal; never show a zero-calorie result.
- Totals are derived from local entries, never from a cached server total.
- `foodPrefs` and `foodMisses` are local-only: remembered portions and coverage misses. Never sync or export them through the server.
- English only. All copy lives in `lib/copy.ts`; no scattered literals and no i18n framework.

## Components

- Function components only. No classes.
- Feature folders own product logic; `components/` holds generic primitives with no data fetching.
- A component that fetches or mutates is a feature component, not a shared one.
- Props are explicit. No spreading arbitrary props onto DOM nodes.
- No barrel files that re-export everything; import from the file.
- Keep components under ~200 lines. Extract a hook or a child before adding a third responsibility.

## TypeScript

- `strict: true`. No `any`.
- External data (API, OFF, file import) is `unknown` until validated.
- No non-null assertions on API or IndexedDB data.
- `@ts-ignore` requires a one-line reason and is a review finding.
- Generated API types are not hand-edited.

## Styling

- Tailwind v4 utilities, themed from `web/src/styles/tokens.css` via `@theme`. No CSS Modules, no styled-components, no inline color literals.
- Every color, radius, and font comes from a token utility (`bg-surface`, `text-ink-2`, `rounded-card`). No arbitrary hex values. Type uses the named scale (`text-body`, `text-meta`, `text-title`, `font-display`), never `text-[15px]`; spacing uses the Tailwind scale. Repeated or stateful patterns become a component, not a copied class string.
- Light and dark are designed together. A component that only works in one theme is incomplete.
- No layout that requires horizontal scrolling at 400 px.
- Respect `prefers-reduced-motion`. No scan-line or sheet animation when reduced.

## Accessibility

- Use Radix primitives for dialogs, switches, and toasts.
- Every input has a label. Errors use `aria-describedby` and are announced.
- Focus is visible and trapped correctly in sheets; focus returns to the trigger on close.
- Touch targets are at least 44×44 px.
- The chart has a table alternative. Color is never the only status signal.
- The scanner has non-camera alternatives and does not trap focus.
- Test with keyboard only on every new surface.

## Scanner lifecycle

- Stop all camera tracks when the route changes, the app is hidden, or a sheet opens.
- Never leave the camera running behind a modal.
- Use the native `BarcodeDetector` when it supports `ean_13`; otherwise dynamically import the ponyfill. Do not put the scanner in the initial bundle.
- Self-host the WASM. No CDN.
- Deduplicate the same code for 2.5 s.
- Announce detection through a polite live region; honor the sound/haptics setting.
- Handle permission denied, no camera, camera busy, and insecure context with actionable copy.
- Do not auto-submit a scanned product. The user confirms the portion and meal.

## Forms

- React Hook Form + Zod. One schema per form; no duplicated validation.
- Validate on submit and on blur, not on every keystroke for numeric fields.
- Accept a decimal comma in numeric inputs.
- Disable the submit button only for an in-flight request, not for invalid input; show the error instead.
- Never lose form state when a sheet is dismissed accidentally without a warning if the form is dirty.

## Performance

- Lazy-load `/scan` and `/history` routes and their heavy dependencies.
- No layout shift when fonts load; use self-hosted `font-display: swap` and a metric-compatible fallback.
- Avoid re-rendering a whole day when one entry changes; live queries should scope to what the component needs.
- Do not memoize by default. Measure before adding `useMemo` or `memo`.
- Keep the initial route JS under 180 KB gzip.

## Offline and errors

- Every route renders without a network request after first load.
- A failed fetch shows a local result or a clear offline state; never a blank screen.
- 401 routes to login without clearing local data. A network failure does not log the user out.
- Cloudflare Access expiry can return HTML or a redirect instead of JSON. Detect a non-JSON API response, keep local data, pause sync, and show "Sign in to continue" linking to the public hostname.
- An error boundary offers reload and export; it never shows a stack trace.
- The sync badge always tells the truth: Offline, Pending N, Syncing, Error, or Synced time.

## Tests

- React Testing Library for behavior, not implementation details.
- `fake-indexeddb` for Dexie tests; reset the database between tests.
- MSW for API behavior. No live network.
- Test the offline path for every new data surface.
- E2E uses mocked detectors or a fake camera; no arbitrary sleeps.

## Review checklist

- [ ] Reads and writes go through repository hooks.
- [ ] No new global state for server data.
- [ ] Tokens only; light and dark both checked.
- [ ] Keyboard and screen-reader path checked.
- [ ] 400 px width checked.
- [ ] Offline path tested.
- [ ] Scanner stops on navigation.
- [ ] Heavy code is lazy-loaded.
- [ ] No `any`, no ignored errors.

## Anti-patterns

- A `useEffect` that fetches the same rows Dexie already has.
- Copying a food into component state and editing both copies.
- A modal that leaves the camera on.
- A chart that relies on color alone.
- A spinner that replaces local data.
- Adding TanStack Query "because it is standard".
- Storing entries in `localStorage`.
