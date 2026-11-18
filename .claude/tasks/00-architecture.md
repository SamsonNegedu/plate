# Architecture and locked decisions

Status: the decision record. The system as built is described in `docs/` (start at `docs/README.md`: architecture, data model, sync, food and search, security, client, API, configuration). This file keeps the reasons behind the choices; where it and `docs/` disagree, `docs/` and the code win.

## Context

One person logs what they eat, mostly packaged German groceries, on a phone in a supermarket or kitchen. The app must survive poor signal, open instantly, scan a barcode, and make the common case (the same oats, yogurt, and coffee) one tap. The backend is self-hosted, so operational simplicity matters more than horizontal scale.

Constraints that drive every decision:

- Single writer is acceptable. A personal food log will never exceed a few thousand rows per year.
- The phone is the primary client. Cold start, camera, and offline behavior are the product.
- No native app, no app store, no accounts system, no analytics.
- Food data is external and imperfect. Corrections must be first-class.
- A lost log entry is worse than a slow one. Durability beats elegance.

## ADRs

### ADR-001 — Single-user, self-hosted, HTTPS-only

One user row, one set of goals, many devices. Every syncable table carries `user_id` so a future multi-user version does not require a schema rewrite, but no sharing or permissions UI ships in v1.

The server listens on `PLATE_ADDR` (default `:8080`) inside its container and is reached through an HTTPS proxy or tunnel the operator runs; the container publishes no port. The camera requires HTTPS on any non-localhost origin, so plain HTTP is not an option off the dev machine.

### ADR-002 — One Go binary embeds the built SPA

`cmd/plate` serves `/api/v1/*`, `/healthz`, `/readyz`, and the Vite build from `go:embed`. Development uses Vite on :5173 with a `/api` proxy to Go on :8080. Production serves one origin, so there is no CORS, no cookie-domain problem, and no separate static host to secure.

Rejected: separate frontend hosting. It adds CORS, cookie configuration, and a second deploy surface for no benefit.

### ADR-003 — SQLite through `modernc.org/sqlite`

- Pure Go, CGO disabled, static cross-compiled binary.
- FTS5 is compiled in, including external-content tables and `bm25()`.
- WAL mode, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- One `*sql.DB` with a small pool. Write transactions acquire a connection and issue `BEGIN IMMEDIATE` explicitly, so two writers fail fast and retry rather than deadlocking on an upgrade.
- The database file lives in a data directory that is not inside the web root. `VACUUM INTO` creates a consistent snapshot before migrations.

`modernc` is roughly 25% slower than the CGO driver. That is irrelevant at this data volume and worth the static binary. If a measured hot path ever needs it, swap to `ncruces/go-sqlite3` behind the same `database/sql` boundary.

### ADR-004 — sqlc for queries, goose for migrations

- `sqlc` generates typed Go from SQL against the goose migration schema. No ORM, no hand-written row scanning.
- `goose` migrations are embedded in the binary and run at startup, before the HTTP listener opens.
- Generated code is committed. `sqlc diff` runs in CI to catch drift.
- Migrations are additive and forward-only in production. A breaking change uses expand/contract across two releases. Every migration has a working `down` for local development.

Rejected: GORM/ent. They hide SQL and add a large surface for a schema this small. Rejected: hand-written scanning. It is where NULL and column-order bugs live.

### ADR-005 — chi + Huma for the API

- `net/http` and `http.Handler` throughout. chi provides route groups and middleware.
- Huma v2 sits on chi, gives typed request/response structs, validation, RFC 9457 problem responses, and an OpenAPI 3.1 document generated from the handlers.
- The TypeScript client is generated from that document with `openapi-typescript`; `openapi-fetch` provides the typed transport. No hand-maintained duplicate types.

Rejected: Gin/Echo/Fiber. They replace `net/http` and buy little. Rejected: hand-written OpenAPI. It drifts. Rejected: gRPC/Connect. A browser PWA gets no benefit from binary RPC and loses easy curl/debugging.

### ADR-006 — Offline-first Dexie client with a small, server-authoritative sync protocol

The client owns the optimistic write. The server owns order and durability.

- Every syncable row has a client-generated UUIDv7. Creates are idempotent by ID; no temporary IDs.
- The client writes to Dexie and the outbox in one transaction.
- The outbox drains as ordered operations to `POST /sync/push`. Each op has an `op_id`; the server stores applied op IDs, so retries and duplicate delivery are safe.
- The server applies the batch, appends rows to a per-user `change_log` with a monotonic `seq`, and stamps each entity with `server_seq`.
- The client pulls `GET /sync/pull?since=<seq>` in pages, applies changes in seq order in one Dexie transaction, and advances a local cursor.
- New devices call `GET /sync/snapshot` for live rows plus a cursor, then pull from there.
- Deletes are tombstones (`deleted_at`), not physical deletes. A client that has not seen a delete cannot resurrect the row by syncing an old update.
- Conflict policy is entity-level last-write-wins using the server receive order. The server returns the winning row; the client replaces its optimistic copy. A local `conflicts` table records overwrites for a Settings audit view.
- Edits to a tombstoned row are rejected with the tombstone returned. Explicit undo is handled before the delete syncs; after it syncs, undo re-creates a new entry rather than resurrecting.
- Tombstones are retained for 180 days. `sync_state.min_seq` is per user; a client below its own `min_seq` must take a fresh snapshot.

Why not a sync engine:

| Candidate | Why not |
|---|---|
| PowerSync | Client SQLite is a good fit, but the service expects Postgres/MySQL/MongoDB as source. Our source is SQLite. |
| ElectricSQL | Postgres-only read-path sync. Writes still need a custom API. |
| Zero / Triplit / Replicache | Postgres or a TypeScript server; not a Go + SQLite backend. |
| RxDB | Large client database layer; the server replication endpoint is still custom; premium plugins complicate licensing. |
| Automerge / Yjs | CRDTs solve multi-writer collaboration. One user with rare device overlap does not need the complexity, and neither has a mature Go server for our shape. |
| PouchDB / CouchDB | Requires CouchDB as the server. That is a second database and a second operational model. |

The custom protocol is deliberately small: three endpoints, one change log, one outbox. It is testable end to end, and every failure mode maps to a user-visible state (pending, offline, conflict, resync required).

### ADR-007 — Server FTS5 plus client MiniSearch

- `foods_fts` is an FTS5 external-content table over name, brand, and barcode, with `unicode61 remove_diacritics 2` so `Kase` matches `Käse` and `joghurt` matches `Joghurt`.
- Ranking uses `bm25(foods_fts, 10.0, 5.0, 50.0)`; an exact barcode match always wins.
- Queries sanitize FTS syntax by quoting every token and append prefix `*` to the final token. `prefix='2 3'` on the FTS5 table serves queries under three characters; the LIKE fallback was slower and missed brands (Spike B).
- The client builds a MiniSearch index over cached foods, so keystrokes produce results before the network answers. Server results merge in and replace local duplicates by barcode or ID.
- If local results are thin, the server proxies Open Food Facts search (search-a-licious), caches the normalized response for 24 hours, and upserts the products so the next query is local.
- German compound nouns are covered by prefix matching and a trigram index (`foods_trgm`, `catalog_trgm`), not by stemming. `Vollkornbrot` and `vollkorn` must both find the product, and `brot` must find `Vollkornbrot`: on the real seed most products containing `käse` or `brot` are compounds. Substring hits rank after whole-word and prefix hits.
- Cached foods carry `source_checked_at`. A recently used food is revalidated against OFF after 90 days; the UI shows "last checked". A user correction is never revalidated or overwritten.
- A product without kcal is not loggable. Return `not_loggable` with the reason and let the user add it manually or use quick add; do not present it as a zero-calorie food.

Rejected: Bleve. It duplicates the index, adds a second persistence model, and solves fuzzy matching we can cover with MiniSearch plus prefix search. Rejected: Meilisearch/Typesense. A separate service for a few thousand rows is not worth the operations.

### ADR-008 — Barcode detection: native API, WASM polyfill, no custom decoder

- Use `BarcodeDetector` when the browser supports `ean_13` (Chrome, Edge, Android).
- Otherwise load the `barcode-detector` ponyfill backed by `zxing-wasm`. It implements the same API, supports EAN-13/EAN-8/UPC-A/UPC-E/Code 128, and runs in Safari and Firefox.
- Self-host the WASM binary and point the module override at it. Never depend on a CDN at runtime: the scanner must work offline and under a strict CSP.
- Detection runs on the video element with `requestVideoFrameCallback` where available, throttled to about 10 fps otherwise. A successful read stops the loop, vibrates, and opens the product sheet.
- Scan formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128. German grocery retail is EAN-13. DataMatrix can be added later for pharmacy/DIY without changing the pipeline.
- Fallbacks in priority order: type the barcode, search by name, upload a photo of the barcode or label, enter the label manually.
- Torch uses `applyConstraints({ advanced: [{ torch: true }] })` after checking `getCapabilities().torch`. No torch UI when unsupported.
- Camera lifecycle: stop tracks when navigating away or opening a sheet; restart on return. Never leave the camera live behind a modal.
- Unknown iOS behavior is a Phase 0 spike, not an assumption.

Rejected: `@zxing/browser` directly. It works but ships a large JS decoder and lacks the standard API shape. Rejected: `html5-qrcode`. Convenient but heavier, less actively maintained, and harder to control. Rejected: a hand-written decoder. Never.

### ADR-009 — Single-user password auth, sessions, optional proxy mode

- Bootstrap with `PLATE_ADMIN_EMAIL` and `PLATE_ADMIN_PASSWORD` on first boot; the password is hashed with Argon2id and the env password is never stored.
- `scs` sessions backed by a small SQLite store implementing its `Store` interface. Cookie is `__Host-plate_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day sliding expiry.
- Login is rate-limited per IP and per account. Session ID rotates on login. Logout deletes the server row.
- State-changing requests require JSON content type and a same-origin `Origin`/`Sec-Fetch-Site` check.
- The app session is the only auth gate. The app never reads forwarded identity or IP headers (`Cf-Access-*`, `CF-Connecting-IP`, `X-Forwarded-For`); rate limits key on the socket peer. Decision (2026-11-18): the proxy auth mode and trusted-proxy settings were removed. Behind a proxy all requests share its address, so the per-address login limit is shared and the per-account limit still applies.
- A proxy or tunnel in front may return an HTML sign-in page instead of JSON; the client shows "Sign in to continue" and keeps local data.
- Passkeys via `go-webauthn` are a post-v1 upgrade.

Rejected: JWT in localStorage. XSS exposure and revocation complexity. Rejected: no auth. The phone needs HTTPS and a remote origin.

### ADR-010 — Proxy and cache product images

The server fetches `images.openfoodfacts.org` images through an allowlisted image endpoint, stores them on disk (bounded LRU), and serves same-origin URLs. The client caches them with Workbox.

This removes a third-party request from the phone, keeps the CSP tight (`img-src 'self' data:`), makes offline images reliable, and avoids leaking the user's IP to the image host on every list render.

### ADR-011 — Cloudflare Tunnel + Access, snapshot backups

Superseded on 2026-11-18: Cloudflare Tunnel and Access were dropped. The container publishes no port and the operator puts any HTTPS proxy or tunnel in front; the app session is the only auth gate (ADR-009). Docker Compose runs `plate` alone and releases are published to ghcr.io. The snapshot-backup and restore-drill points still stand. The original text follows for the record.

- Cloudflare Tunnel terminates TLS at Cloudflare and reaches the Go process through cloudflared. No inbound ports are open on the origin.
- Cloudflare Access gates the hostname with the operator's identity. The app keeps its own password session as a second layer; a tunnel or Access misconfiguration does not expose the log.
- Security headers are set by the app and reinforced at Cloudflare. HSTS is enabled at the edge.
- Cloudflare cache rules bypass `/api/*`, `/healthz`, and `/readyz`; immutable build assets may be cached at the edge.
- Backups are `VACUUM INTO` snapshots copied off the host. There is no replication sidecar.
- A restore drill is part of the launch checklist, not an afterthought.
- Docker Compose is the default packaging: `plate` and `cloudflared`. The operator handles host-level services such as process supervision.
- Cloudflare is in the request path. If the tunnel is down, the app is unreachable; this is accepted for a personal app, and the origin is never exposed as a fallback.

### ADR-012 — No SSR, no native app, no analytics

The app is a private, client-rendered PWA. SSR adds a Node runtime and a second rendering path for no SEO or sharing benefit. A native wrapper adds store review and duplicate camera code. Analytics contradict the privacy constraint; server logs and a local diagnostics panel are enough.

### ADR-013 — English-only UI, translatable copy boundary

The interface ships in English. German product names, umlauts, and German search are fully supported; a German UI is out of scope for v1.

All user-facing copy lives in `web/src/lib/copy.ts` (or a small `copy/` module) rather than being scattered as literals. No i18n framework, no runtime locale switching. The boundary exists so a future translation is a mechanical change, not a rewrite. Dates and numbers use en-GB; product data keeps its original spelling.

### ADR-014 — Operational actions without a custom CLI

No separate `plate` command tree. Operational actions are startup flags applied once, then removed from the environment:

- Password reset: `PLATE_ADMIN_PASSWORD` plus `PLATE_ADMIN_RESET_PASSWORD=true` updates the hash and revokes all sessions.
- FTS rebuild: `PLATE_REINDEX_FTS=true` rebuilds the search index on startup.
- Sync kill switch: `PLATE_SYNC_ENABLED=false` makes the server return `503 sync_disabled`; clients keep logging locally and show the state.
- Maintenance: the process runs `PRAGMA optimize`, a WAL checkpoint, cache pruning, and change-log pruning on a schedule.

This keeps the deployment to one binary and one config surface. The runbook documents the flags; there is no second binary to install or forget.

### ADR-015 — OFF catalog seed as the local German catalog

The catalog is built from the OFF German subset, not from a third-party identity-only index. It keeps nutrition, so a seed hit is loggable without a network call.

- Build artifact: stream the OFF dump, filter `countries_tags = Germany`, require `kcal_100g`, normalize with the same pipeline, clean names, merge near-duplicates, deduplicate by barcode, and keep every product with at least 2 unique scans (about 71k rows on the 2026-11-12 dump; Spike F and Phase 5 measured 91% corpus coverage and 86% of scan volume). `make catalog MIN_SCANS=1` widens it.
- Fields: barcode, name, brand, quantity, serving size/grams, per-100 g nutrients, Nutri-Score, image source URL, dataset version.
- Import into `catalog_foods`, a separate reference table. It is not user-scoped and is never synced.
- Lookup order: user `foods` cache → `catalog_foods` → OFF → manual. Search: exact barcode → FTS5 over `foods` and `catalog_foods` → OFF fallback.
- Revalidate stale user rows in the background; refresh the seed on a release cadence. Store `dataset_version` and `imported_at`; a re-import replaces the table in one transaction.
- License: OFF ODbL. We build and distribute the derivative, so attribution and share-alike are ours to satisfy.
- Offline: v1 serves the catalog from the server. A top-5k starter pack for Dexie is a v1.1 option.
- No identity-only rows: the seed filters out products without kcal, and every result is loggable.

## Where the detail lives

The API, data model, sync protocol and search behavior used to be specified here. They are now described from the code in `docs/api.md` (generated from the OpenAPI spec), `docs/data-model.md`, `docs/sync.md` and `docs/food-and-search.md`, so they cannot drift from what is built.

## Performance budgets

| Path | Budget |
|---|---|
| Cold app shell on 4G | < 2.0 s LCP, < 3.0 s TTI |
| Route change | < 100 ms |
| Local search keystroke → results | < 50 ms |
| Cached barcode lookup | < 50 ms |
| Online barcode lookup p95 | < 800 ms |
| Scan first decode | < 2 s in good light |
| Sync push/pull 100 ops p95 | < 300 ms |
| Server RSS | < 120 MB |
| Client JS (gzip, initial route) | < 180 KB |
| SQLite size after 5 years | < 50 MB |

## Browser and device support

| Platform | Target | Scanner path |
|---|---|---|
| iOS Safari 17+ | PWA installed to home screen | WASM ponyfill |
| Android Chrome 120+ | PWA | Native BarcodeDetector |
| Desktop Chrome/Edge | Full app | Native |
| Desktop Firefox | Full app, scanner via WASM | Ponyfill |
| Desktop Safari | Full app, scanner via WASM | Ponyfill |

Background Sync is Chromium-only. iOS relies on foreground sync triggers; this is why the outbox must be durable and the UI must show pending state.

## Security model

| Threat | Mitigation |
|---|---|
| Credential stuffing | Argon2id, per-IP and per-account rate limits, generic login error |
| Session theft | HttpOnly/Secure/SameSite cookie, rotation on login, server-side revocation |
| CSRF | SameSite=Lax plus Origin/Sec-Fetch-Site checks on mutations |
| XSS via product names | React escaping, strict CSP, no `dangerouslySetInnerHTML` |
| SQL injection | sqlc parameterized queries; FTS query sanitization |
| SSRF via OFF/image proxy | Fixed allowlisted hosts, no user-supplied URLs, response size cap |
| Abuse of the proxy | Per-IP and global rate limits, disk cache bounds |
| Data loss | WAL, pre-migration snapshot, off-host snapshot, export, restore drill |
| Exposed origin | The app publishes no port; reach it only through the operator's HTTPS proxy or tunnel; the app password is the gate |
| Spoofed client IP or identity | Forwarded headers are never read; rate limits key on the socket peer |
| Dependency compromise | Lockfiles, pinned versions, `govulncheck`, `pnpm audit`, SBOM |

CSP baseline: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'`.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| iOS camera or WASM scan fails or is slow | Medium | High | Phase 0 device spike; photo upload; typed barcode; manual entry |
| OFF coverage gaps for discounter own-brands | High | Medium | OFF catalog seed, no-match path, one-time label entry, BLS generic foods, correction flow |
| Catalog seed misses a common product | Medium | Medium | Coverage corpus, seed ranking by scan counts, OFF fallback, user cache |
| Catalog seed goes stale | Medium | Medium | Dataset version, release refresh, background revalidation, stale hint |
| OFF dump build is slow or too large | Medium | Low | Seed filtered to products with calories (about 70,000 rows); streaming build |
| OFF rate limits or outage | Medium | Medium | Server proxy, cache, circuit breaker, manual fallback |
| Sync bug loses or duplicates a write | Medium | High | Idempotent ops, tombstones, two-client tests, export, local-only kill switch |
| SQLite lock contention | Low | Medium | WAL, one writer, `BEGIN IMMEDIATE`, busy timeout, single-user load |
| German compound search misses | Medium | Medium | Prefix search, MiniSearch fuzzy, trigram fallback, German fixtures |
| ODbL attribution/share-alike missed | Low | Medium | In-app attribution, license page, legal check before any DB redistribution |
| Browser storage eviction | Medium | High | `navigator.storage.persist()`, server source of truth, export reminders |
| Day rollover/timezone bugs | Medium | Medium | Explicit local date, configurable day start, DST and midnight tests |
| PWA update during a scan | Low | Medium | Prompt-based updates, defer while camera or sheet is active |
| Proxy or tunnel outage | Medium | High | App is unreachable while down; local logging continues if the PWA is installed |
| A proxy sign-in page replaces JSON | Low | Medium | Client detects a non-JSON response, keeps local data and offers "Sign in to continue" |
| Scope creep (recipes, weight, OCR) | High | Medium | Explicit non-goals; backlog only |

## Non-goals for v1

Recipes and ingredient math, weight tracking, photo OCR, restaurant menus, social features, multi-user households, native apps, push notifications, a German UI, full-text search of the entire OFF corpus, and offline access to uncached products.

### ADR-016 — Tailwind CSS v4 replaces CSS Modules
Decision (2026-11-18, user): style the client with Tailwind CSS v4 instead of CSS Modules.
- `web/src/styles/tokens.css` stays the single token source. Tailwind's `@theme inline` maps each token to a utility (`bg-surface`, `text-ink-2`, `rounded-card`), so light, dark and `data-theme` still switch through the CSS variables and no `dark:` variants are used.
- Dependencies: `tailwindcss` and `@tailwindcss/vite` (build-time only; nothing ships at runtime beyond the generated CSS).
- No arbitrary colors; no new spacing system. Repeated or stateful patterns are components, not copied class strings.
- The design floor is unchanged: the Playwright pixel baselines (`web/e2e/visual.spec.ts`) must pass untouched through the migration.
- Typography is named, not inline: `text-micro/caption/meta/label/body/input/section/glyph/stat/heading/title/wordmark/display`, plus `leading-*` and `tracking-display`, all defined in `@theme`. Off-scale sizes were folded into the nearest step (13.5 px to 13, 14.5 px to 14); the Settings baselines were refreshed for that one change.

### ADR-017 — oxlint and oxfmt replace Biome for the web
Decision (2026-11-18, user): lint with oxlint and format with oxfmt. Biome could not parse Tailwind v4 CSS directives, and oxfmt sorts Tailwind classes and imports.
- `web/.oxlintrc.json`: correctness errors plus explicit React rules (hooks, purity, refs, no nested ternaries, no unstable components, no index keys) and `no-explicit-any` / `no-non-null-assertion`.
- `web/.oxfmtrc.json`: Biome's formatting options, `sortTailwindcss` (via the `cn` helper and `className`), and `sortImports`.
- `pnpm lint` runs `oxlint && oxfmt --check`; `pnpm fmt` writes.

