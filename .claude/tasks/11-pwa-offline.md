# Phase 10 — PWA and offline hardening

Status: implemented; verification pending (Phases 8 and 9 code is in place)
Depends on: 8, 9
Blocks: 11, 12

## Goal

Install it to the home screen, open it in a supermarket basement, log a cached food, close it, and have the entry sync later without a spinner or a lost write.

## Manifest

- `name`: Plate
- `short_name`: Plate
- `start_url`: `/today`
- `display`: `standalone`
- `display_override`: `["standalone", "minimal-ui"]`
- `orientation`: `portrait`
- `theme_color` and `background_color` from the light surface tokens.
- Icons: 192, 512, and a maskable 512. SVG favicon for desktop.
- Shortcuts: `Scan` → `/scan`, `Today` → `/today`.
- Categories and description are optional; no screenshots required for a private app.

## Service worker

Use `vite-plugin-pwa` with **`injectManifest`**, not `generateSW`. The custom worker is small and needs the navigation fallback, image caching, and update behavior explicitly.

Precache:

- App shell: HTML, JS, CSS.
- Fonts: Barlow and Barlow Condensed WOFF2.
- Icons.
- The ZXing WASM binary.
- `offline.html` as a last-resort fallback.

Navigation:

- `navigateFallback: "/index.html"`.
- Denylist `/api/` and `/healthz`.
- If a navigation fails and the shell is unavailable, serve `offline.html`.

Runtime caching:

| Route | Strategy | Expiry |
|---|---|---|
| `/api/v1/images/*` | CacheFirst | 60 days, 300 entries |
| `/wasm/*` | CacheFirst | 1 year, 5 entries |
| Everything else same-origin static | Precache | versioned |
| `/api/*` | NetworkOnly | never cache in the SW; Dexie is the data cache |

Never cache non-GET requests. Never cache API responses in the SW; a second cache layer would fight the sync engine.

## Update flow

- `registerType: "prompt"`.
- When a new worker is waiting, show a persistent toast: "New version ready" with Reload.
- Do not auto-reload while the scanner is active, a sheet is open, or the outbox is draining.
- On confirm, send `SKIP_WAITING`, wait for `controllerchange`, then reload.
- `cleanupOutdatedCaches: true`.
- The app version and build commit are visible in Settings.

## Offline behavior

- The shell opens offline after the first successful load.
- Today, History, Settings, and cached food details render from Dexie.
- A scan of a cached barcode works. An uncached barcode opens the manual sheet with the barcode prefilled and a clear "not saved offline" message.
- Search shows local results and a "Search is offline" note. No empty-state lie.
- Logging, editing, deleting, copy yesterday, and quick add all work.
- The sync badge shows `Offline`, `Pending N`, or `Synced <time>`.

## Online detection and sync triggers

- `online`/`offline` events update the banner, but a failed request is the real signal.
- Sync runs on app start, after a mutation (800 ms debounce), when the app becomes visible, every 60 s while visible, and on manual "Sync now".
- Background Sync is out of scope for v1. It is Chromium-only, iOS lacks it, and foreground logging already opens the app. Revisit if the outbox regularly carries work across long closed periods.

## Storage durability

- On first successful load, call `navigator.storage.persist()`; tolerate denial.
- Settings shows `navigator.storage.estimate()` usage and quota.
- On `QuotaExceededError`, show a persistent banner: "This device is out of storage. Export your data." Do not silently drop writes.
- Prompt for an export after 30 days without one, and after a large import.
- The server remains the source of truth; a cleared browser recovers from a snapshot.

## Install UX

- Android/Chrome: capture `beforeinstallprompt`; expose "Install Plate" in Settings and a one-time prompt after the first successful log.
- iOS: a dismissible sheet with Share → Add to Home Screen. Show once, remember dismissal.
- Hide install prompts in standalone mode.
- Do not nag on every visit.

## Performance

- Initial route JS under 180 KB gzip.
- Lazy-load the scanner module and the WASM only on `/scan`.
- Lazy-load Recharts on `/history`.
- Preload the app shell fonts with `font-display: swap`; self-host and subset to Latin + German characters.
- Verify Lighthouse mobile: performance ≥ 90, PWA installable, no console errors.
- Test on a throttled 4G profile and a mid-range Android device, not only a desktop.

## CSP and the service worker

- `script-src 'self' 'wasm-unsafe-eval'` for the scanner.
- `worker-src 'self' blob:` for Workbox.
- `connect-src 'self'` only. No external API calls from the browser; all OFF traffic goes through the Go server.
- `img-src 'self' data:` only; images are proxied.

## Tests

- Offline reload after first load renders Today from the SW.
- Add an entry offline, reload offline, entry remains.
- Reconnect, sync, second device sees the entry.
- Scanner WASM is precached and decodes offline.
- Uncaught API requests are not cached by the SW.
- Update prompt appears on a new build; reload applies it; no reload during a scan.
- Quota-exceeded path shows the banner (simulate a tiny quota in a test build).
- Install prompt behavior on Android and the iOS instruction sheet.
- Lighthouse PWA audit passes.
- No console errors or failed requests on any route.

## Manual device pass

- iPhone Safari: install, camera permission, scan, torch absence, offline log, reconnect sync, safe areas, keyboard over sheets.
- Android Chrome: install, camera, torch, native detector, offline log, background resume.
- Desktop: Firefox ponyfill, Chrome native, Safari ponyfill.

## Deliverables

- [ ] Manifest and icon set.
- [ ] Custom service worker with precache, navigation fallback, image/WASM caching.
- [ ] Update prompt and reload guard.
- [ ] Offline banner, pending badge, storage persistence and quota handling.
- [ ] Install UX for Android and iOS.
- [ ] Lazy-loaded scanner and chart bundles.
- [ ] PWA/offline test suite and device notes.

## Acceptance

- Airplane-mode logging works end to end for cached foods and manual entries.
- A reload while offline never shows a browser error page.
- Reconnecting syncs without user action and without duplicates.
- The app is installable on iOS and Android.
- Lighthouse PWA passes; performance ≥ 90 on the mobile profile.
- No API response is served from the SW cache.

## Out of scope

Background Sync, push notifications, share targets, and a native wrapper.
