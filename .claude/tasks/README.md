# Plate v1 — end-to-end build plan

Planning only. No application code lives here; this directory is the execution map.

## What we are building

An offline-first PWA for logging calories by barcode, backed by a Go service and SQLite. German retail products come from Open Food Facts (ODbL); generic foods come from BLS 4.0. The approved visual direction is `../../mockups.html`.

The product loop: scan or search a food, choose grams or a portion, assign a meal, log it, see the day, review history. Repeat foods, saved meals, quick add, and a no-match path are v1 requirements, not later polish.

## Data sources

| Source | Provides | Role |
|---|---|---|
| OFF catalog seed | 20k–50k common German products built from the OFF dump, with per-100 g nutrition and serving info | Local catalog for the common path, so OFF is the fallback |
| Open Food Facts | Full product record, nutrition, ingredients, images | Long tail, refresh, and missing seed rows |
| BLS 4.0 | ~7,100 generic foods with nutrients | Generic foods without a barcode |

The catalog seed is our own filtered OFF subset, so it carries the nutrition needed to log. A seed hit never calls OFF.

## Non-negotiables

- Barcode-first, never barcode-only: search, quick add, manual label entry, and a typed barcode all work.
- Logging works offline for cached foods. Writes queue locally and sync after reconnect.
- No analytics or third-party runtime services. Accounts are open signup with no administrator (ADR-016). Food data is the only external dependency.
- One static Go binary serves the API and the built SPA. SQLite is the only datastore.
- The client is optimistic; the server is authoritative for sync order.
- Every logged entry stores a nutrition snapshot, so later data changes never rewrite history.

## Stack summary

| Layer | Pick | Why |
|---|---|---|
| SPA | React 19 + TypeScript + Vite | Current baseline, tiny runtime, first-class PWA tooling |
| Routing | React Router 7 (library mode) | Stable, no SSR needed for a private PWA |
| Offline store | Dexie 4 (IndexedDB) + `dexie-react-hooks` | Durable local tables, live queries, migrations |
| Local search | MiniSearch | Instant fuzzy search over cached foods, no server round trip |
| Barcode | native `BarcodeDetector` + `barcode-detector` ponyfill + `zxing-wasm` | No decoder hand-rolling; iOS/Firefox fallback |
| PWA | `vite-plugin-pwa` 2 + Workbox 7 | Precache, update prompt, runtime image cache |
| UI primitives | Radix UI | Accessible dialogs, toasts, switches |
| Forms | React Hook Form + Zod | One validation model shared by form and client |
| Charts | Recharts | Accessible SVG bars with tooltips and responsive sizing |
| HTTP | Go `net/http` + chi + Huma v2 | Stdlib-compatible routing, typed handlers, OpenAPI 3.1 |
| SQLite | `modernc.org/sqlite` | Pure Go, CGO-free, FTS5 enabled, static binary |
| Queries | sqlc | Type-safe SQL generated from the schema; no ORM |
| Migrations | goose v3 (embedded) | SQL-first, up/down, runs on startup |
| Auth | `alexedwards/scs/v2` + `argon2id` | Mature sessions, OWASP-aligned hashing |
| IDs | UUIDv7 (`google/uuid`) | Client-generated, time-ordered, idempotent creates |
| Backups | SQLite snapshots | `VACUUM INTO` copies, kept off the host |
| Edge / TLS | Cloudflare Tunnel + Access | No open ports, Cloudflare-managed TLS, Access gate before the app |
| Tests | Go `testing`, Vitest, RTL, Playwright | Unit through device-level flows |

Exact minor versions are pinned in Phase 1 and recorded in `go.mod`, `pnpm-lock.yaml`, and the SBOM.

## Guardrails

`CLAUDE.md` at the repository root is the entry point. It holds the non-negotiables, commands, repo map, and the forbidden list.

Project skills live in `.claude/skills/` and are loaded automatically when their trigger matches:

| Skill | Use when |
|---|---|
| `phase-workflow` | Starting, resuming, or finishing a phase |
| `golang-code-style` (vendored) | Any Go work: line-level style and clarity |
| `react-pwa` | React, TypeScript, Dexie, routing, forms, scanner, PWA |
| `testing` | Writing or changing tests, fixtures, or CI |
| `sync-integrity` | Entries, outbox, change log, tombstones, undo |
| `security` | Auth, sessions, CSP, proxy, import/export, dependencies |
| `ui-design-system` | Screens, sheets, components, charts, copy |
| `release-review` | Before marking a phase done or merging |

`.claude/settings.json` pre-approves the normal dev commands and denies destructive ones (`sudo`, `rm -rf`, force-push, `git reset --hard`, `git clean`, `docker compose down -v`). It does not change the overall permission mode.

**Design floor:** `mockups.html` is the minimum, and `design-parity.md` is the required screen/state matrix. Every UI phase must match or improve it; a deviation requires updating the mockup in the same change.

## Phase map

Phases 1 to 10 are built, and their phase files were removed once implemented (the code, `db/migrations`, `docs/` and `00-architecture.md` are the record). What remains:

| Phase | File | Size | Exit criterion |
|---|---|---|---|
| 0 | `01-spikes.md` | S | iOS/Android scan runs (spikes A and E), seed build artifact and real corpus, ADR-015 notes |
| 11 | `12-testing-qa.md` | M | Device matrix, a11y, security, perf, restore drill |
| 12 | `13-deploy-launch.md` | M | Fresh deploy, backup restore, 14-day dogfood |
| 13 | `14-food-corrections-ocr.md` | L | Shared OFF-shaped corrections, plausibility warning, nutrition-table OCR |

Carried over from Phases 8 to 10, still to verify on a real phone: the design-parity walk (`design-parity.md`), airplane-mode logging and reconnect sync, and the installed-PWA checks on iOS and Android.

## Global definition of done

- Every phase passes its own acceptance checklist and `make verify`.
- No P1 or P2 defects open at phase exit.
- The OpenAPI document and generated TypeScript types are in sync.
- New behavior has a test at the lowest useful level; sync, auth, and nutrition math have integration tests.
- The app works at 400 px width, with keyboard, and with reduced motion.
- The design parity matrix is satisfied; every screen and state is present and no worse than the mockups.
- Logging, barcode lookup, and sync never lose a write across an offline reload.
- Every external data source is attributed in the UI.

## Assumptions (locked unless the user says otherwise)

- Many accounts, each with multiple devices. Open signup, no admin, no email (ADR-016). No sharing, households, or social features.
- Self-hosted behind Cloudflare Tunnel with Cloudflare Access in front, always over HTTPS. The origin has no inbound ports; only cloudflared reaches the app.
- English UI with en-GB dates and numbers. German product search and umlaut folding are required. German UI is out of scope; English copy lives in one module so a translation can be added later.
- v1 includes recents, favorites, saved meals, quick add, and label corrections (shared across accounts from Phase 13, ADR-020).
- v1 includes a 20k–50k OFF catalog seed. The full German subset (300k–500k) is an optional larger seed.
- v1 excludes push notifications. Nutrition-table OCR arrives in Phase 13 (ADR-021).
- Password auth in v1; passkeys are a later upgrade.
- Offline covers cached foods and generic foods. The catalog seed is server-side; a client starter pack is a v1.1 option.

## Open decisions for the user

1. Build a 20k–50k common-products seed, or import the full German OFF subset (300k–500k) on the server?
2. Is weight tracking in scope for v1? Plan assumes no.

## Progress tracker

Update in place. This is the single source of truth for phase state.

- [ ] Phase 0 — Spikes and decisions (B, C, D, F done; A and E need a phone)
- [x] Phases 1 to 7 — foundation, data model, auth, core API, food and search, sync, frontend foundation
- [x] Phases 8 to 10 — logging UI, history and settings, PWA and offline (built; device verification carried over to Phase 11)
- [x] Accounts — open signup, proof of work, recovery codes, per-account limits (ADR-016, `docs/accounts.md`)
- [ ] Phase 11 — Testing and QA
- [ ] Phase 12 — Deploy and launch
- [x] Phase 13 — Shared food corrections and nutrition-table OCR (built 2026-11-21, not through review; phone measurements and the OCR gate are still open)
- [ ] Design parity sign-off after Phases 8, 9, and 10

## How to execute

- Read `00-architecture.md` before starting any phase.
- One phase at a time. Implement, verify, update the tracker, commit, then move on.
- Pause for review after Phases 0, 4, 6, 9, and 12. These are the points where a wrong decision is most expensive.
- Keep decisions current. If a locked decision changes, edit `00-architecture.md` first, then the affected phase.
