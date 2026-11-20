# Phase 11 — Testing and QA

Status: blocked on Phase 10
Depends on: all prior phases
Blocks: 12

## Goal

Prove the product end to end on the devices and failure modes that matter, and leave a repeatable gate for future changes.

## Test layers

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Go unit | `testing` | Nutrition math, dates, FTS query builder, normalization, sync rules | `go test ./...` |
| Go integration | `httptest` + temp SQLite | Auth, entries, search, sync, export/import, image proxy | `go test ./...` |
| Contract | Huma OpenAPI snapshot + `openapi-typescript` diff | API shape and client types | `make verify` |
| Frontend unit | Vitest + RTL + `fake-indexeddb` | Hooks, repositories, portion math, forms, sync states | `pnpm test` |
| E2E | Playwright | Login, scan, log, history, offline, sync, settings | `make test-e2e` |
| Performance | Go benchmarks + Lighthouse CI | Search, sync, cold load | budgets below |
| Coverage | `make coverage` over `testdata/barcodes-de.csv` | Local resolution per chain | ≥70% local at 50k, ≥95% overall |
| Accessibility | axe + manual screen reader | Every route and sheet | no serious violations |
| Visual | Playwright screenshots | Every surface/state at 400 px, light and dark | no diff vs approved baseline |
| Security | `govulncheck`, `gosec`, `pnpm audit`, auth/CSRF/SSRF tests | Dependencies and boundary | zero high findings |
| Restore | Snapshot restore drill | Backup integrity | restore succeeds |

## Critical test cases

### Nutrition and dates

- kcal and macros for 1 g, 100 g, 250 ml, a portion, and a piece.
- Missing nutrient stays `NULL` and surfaces as `—`, never 0.
- Day totals ignore unknown nutrients and report `missing`.
- Day start hour and local midnight, including a DST transition.
- An entry at 00:30 with day start 4 belongs to the previous day when the client assigns it.
- Rounding: 0.4 kcal displays 0; 0.5 displays 1; totals sum before rounding.

### Barcode and normalization

- Real OFF fixtures: Nutella, ja! yogurt, a liquid, a per-serving-only product, a missing-protein product, an invalid Nutri-Score, an unnamed product.
- Per-serving data is never stored as per-100 g.
- 12-digit UPC and 13-digit EAN resolve to the same product.
- Unknown barcode produces the no-match state, not a 500.
- A user correction survives a later OFF fetch.
- Image requests cannot escape the allowlist.

### Coverage and freshness

- The 200+ barcode corpus reports local resolution (user cache + catalog) versus OFF fallback per chain. Target: 70% local at the 50k seed, 95% overall.
- A catalog hit logs without an OFF call and without a manual step.
- A catalog import is idempotent; a bad or empty file leaves the previous catalog intact; duplicate barcodes resolve last-wins; rows without kcal are skipped.
- The catalog is excluded from the logical export and client sync.
- A miss goes to the manual flow with the barcode prefilled and is recorded in local `foodMisses`.
- A cached food older than 90 days revalidates at most once per 24 hours and does not block the sheet.
- A user correction is never overwritten by a revalidation.
- A product with no kcal returns `not_loggable` and offers manual/quick add.
- A stale row still logs; the stale hint is visible.

### Saved meals, favorites, and custom foods

- Save a meal from a day; log it again; edit items; delete it.
- Favorite pins above search; unfavorite removes the pin.
- Custom food create/edit/delete; historical entries keep their snapshots.
- A deleted custom food does not break a saved meal that referenced it.

### Search

- German fixtures in the top 3: `joghurt`, `Joghurt`, `käse`, `Kase`, `Vollkornbrot`, `vollkorn`, `Müller`, `ja!`, `Gut & Günstig`, `Milbona`, `Hähnchenbrust`.
- Punctuation in `ja!` and `Gut & Günstig` does not break FTS.
- A two-character query uses the LIKE fallback.
- Favorites and recents rank above equal text matches.
- Search is instant from MiniSearch while the server is slow.
- Offline search keeps local results and shows the offline note.

### Sync

- All 8 cases from `01-spikes.md`, plus:
- A randomized two-client convergence run of 1,000 operations.
- A batch with one invalid op applies the rest.
- Crash mid-push returns `inflight` to `pending`.
- A cursor below `min_seq` forces a snapshot and preserves pending user ops.
- Two tabs do not double-push.
- A 401 pauses sync without losing the outbox.
- A server 500 retries with backoff and eventually succeeds.
- `PLATE_SYNC_ENABLED=false` pauses sync; entries keep logging and drain after re-enable.
- Export/import restores the exact live set; the frozen N-1 fixture imports.

### Auth

- Signup creates an account and eight recovery codes; a restart creates nothing.
- A recovery code resets a password once; unknown user, wrong code and spent code look the same.
- Two accounts never see, overwrite or sync each other's rows; deleting one leaves the other intact.
- Signing in as a different account on one device clears the previous account's local rows.
- Login, logout, expired session, rate limit, foreign Origin, forwarded identity headers ignored.
- Cookie flags and `__Host-` prefix.
- Session survives restart.
- A logged-out device cannot sync.

### PWA

- Offline reload, offline logging, reconnect sync.
- Update prompt applies a new build.
- WASM is cached and scans offline.
- API routes are not in the SW cache.
- Install prompt behavior.
- No console errors on any route.

## E2E camera strategy

Two modes, both in CI:

1. **Mocked detector**: inject a fake `BarcodeDetector` that returns a known EAN after two frames. Covers the UI flow deterministically without a camera.
2. **Fake media**: Chromium launched with `--use-fake-device-for-media-stream` and `--use-file-for-fake-video-capture=fixtures/ean13.y4m`. The Y4M is generated from a valid EAN-13 PNG with ffmpeg. Covers the native detector path.

Keep a real-device manual pass for the things CI cannot see: torch, autofocus, low light, iOS permission prompts, and the installed PWA.

## Device matrix

| Device | Browser | Must pass |
|---|---|---|
| iPhone 13+ | Safari, installed PWA | Scan via WASM, offline log, sync, safe areas, keyboard |
| iPhone SE | Safari | Layout at 375 px, sheet height with keyboard |
| Pixel 6+ | Chrome, installed PWA | Native detector, torch, offline, install |
| Mid-range Android | Chrome | Performance, memory, camera |
| Mac | Safari, Chrome, Firefox | Ponyfill/native split, charts, keyboard |
| Windows | Chrome, Edge | Native detector, install |

## Performance gates

- Lighthouse mobile: performance ≥ 90, accessibility ≥ 95, PWA installable.
- Cold shell LCP < 2.0 s on throttled 4G.
- Local search keystroke to result < 50 ms.
- Cached barcode lookup p95 < 50 ms; online < 800 ms.
- Sync of 100 ops < 300 ms locally.
- Server RSS < 120 MB with 10,000 entries and 5,000 foods.
- No memory growth after 50 scan/log cycles in a session.

## Security gates

- `govulncheck ./...` clean.
- `golangci-lint` including `gosec` clean.
- `pnpm audit` no high/critical.
- CSP has no `unsafe-inline` for scripts.
- A fuzz test for the barcode parser, FTS query builder, and import validator.
- Import rejects a 50 MB file cleanly.
- Login timing does not reveal account existence.
- Image proxy rejects arbitrary URLs and non-image content.

## Accessibility gates

- axe: zero serious or critical violations on every route and sheet.
- Keyboard-only pass: scan fallback, search, add, edit, delete, settings.
- VoiceOver on iOS: Today summary, meal rows, product sheet, chart table.
- TalkBack on Android: same.
- 200% text zoom: no clipped controls.
- Reduced motion: no scan-line animation, no sheet bounce.

## Manual launch checklist

- [ ] 50 German barcodes across the seven chains tested.
- [ ] Design parity matrix walked after Phases 8, 9, and 10; deviations fixed or mockups updated.
- [ ] Visual regression baselines approved and CI green.
- [ ] The 200+ barcode corpus and per-chain identity/nutrition hit rate report archived.
- [ ] Catalog dataset version, row count, and ODbL attribution recorded.
- [ ] 20 of them logged end to end, including two no-match entries.
- [ ] One offline session in airplane mode with a cached food.
- [ ] A stale product revalidates and a user correction survives.
- [ ] Two devices converge after mixed online/offline edits.
- [ ] Export, wipe, import, verify.
- [ ] Delete all data and verify the server and local store are empty.
- [ ] Restore from a snapshot into a fresh container.
- [ ] Install on iOS and Android from a clean browser profile.
- [ ] Low-light scan and torch pass.
- [ ] Screen reader pass on Today, Product, History.
- [ ] Lighthouse and axe reports archived.

## Bug severity

- **P1**: data loss, auth bypass, sync corruption, app crash on launch. Blocks launch.
- **P2**: scan failure on a supported device, wrong nutrition math, offline failure, unreadable chart. Blocks launch.
- **P3**: layout polish, copy, non-blocking errors. Can ship with a dated fix.

## Deliverables

- [ ] Full test suites wired into CI.
- [ ] Fake camera fixtures and both E2E modes.
- [ ] Performance, accessibility, and security reports archived under `docs/qa/`.
- [ ] Device matrix results with device/browser versions.
- [ ] Launch checklist completed and signed off.

## Acceptance

- All gates above pass or have a written, accepted exception.
- No open P1 or P2 bugs.
- A new contributor can run the full suite from the README.
- The restore drill has been performed, not just documented.
