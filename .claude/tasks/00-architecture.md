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

### ADR-001 — Self-hosted, HTTPS-only, one account per person

Originally single-user; ADR-016 (2026-11-20) opened it to many accounts. Each account has its own goals and many devices. Every syncable table carries `user_id`, so accounts are isolated by construction. No sharing, households or permissions UI ships.

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

### ADR-009 — Password auth, sessions, optional proxy mode

- Accounts are created by signup, not at boot (ADR-016). Passwords are hashed with Argon2id and never stored in the clear.
- `scs` sessions backed by a small SQLite store implementing its `Store` interface. Cookie is `__Host-plate_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day sliding expiry.
- Login is rate-limited per IP and per account. Session ID rotates on login. Logout deletes the server row.
- State-changing requests require JSON content type and a same-origin `Origin`/`Sec-Fetch-Site` check.
- The app session is the only auth gate. The app never reads forwarded identity or IP headers (`Cf-Access-*`, `CF-Connecting-IP`, `X-Forwarded-For`); rate limits key on the socket peer. Decision (2026-11-18): the proxy auth mode and trusted-proxy settings were removed. Behind a proxy all requests share its address, so the per-address limits are sized for everyone together and the per-account limit still applies.
- A proxy or tunnel in front may return an HTML sign-in page instead of JSON; the client shows "Sign in to continue" and keeps local data.
- Passkeys via `go-webauthn` are a possible later upgrade.

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

- Password reset is not an operator action: people use a recovery code (ADR-016). There is no password-reset flag.
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

### ADR-016 — Open accounts with no administrator

Decision (2026-11-20): Plate serves any number of accounts. Anyone who can reach the server can sign up, and no person has to administer the others. This supersedes the single-user parts of ADR-001, ADR-009 and ADR-014 and removes "multi-user accounts" from the forbidden list. Sharing, households, roles and social features stay out of scope: accounts are isolated, never linked.

Constraints that shaped it: it must run with no external interference (no operator step to add or reset a person), no email service, no third-party runtime service, one binary, one SQLite file.

- **Identity.** A username and a password. `users.email` became `users.username`, so the former admin signs in unchanged and is an ordinary account. No email is collected, so none is verified and there is no personal data beyond a chosen name. There is no admin role.
- **Signup.** Open, behind a self-hosted proof of work: the server signs a salt, a difficulty and an expiry with an in-memory HMAC key; the browser finds a counter so `SHA-256(salt:counter)` has that many leading zero bits; the server verifies it once, before spending Argon2id time. Difficulty is 17 bits (about a second) and rises by 1 or 2 bits when many accounts appear in ten minutes, then falls back by itself. A global 200 an hour cap is the last backstop. Stdlib only: `crypto/hmac`, `crypto/sha256`, no new dependency. `PLATE_SIGNUP_ENABLED=false` is the operator's off switch, not a requirement.
- **Recovery.** Eight single-use recovery codes are shown once at signup (50 bits each, hashed at rest). A code resets the password, spends itself and ends every session. Regenerating needs the password. Losing the password and all codes loses the account; that is the cost of having no admin and no email. There is no operator reset either: the host cannot touch a person's password.
- **Isolation.** Every syncable table already carried `user_id`, so the schema needed no rewrite. Queries stay scoped by user id; tests assert that one account cannot read, overwrite, delete, pull or snapshot another's rows.
- **Shared resources.** Per-account caps (50,000 entries, 5,000 custom foods) and per-user barcode lookups replace per-address limits, which are meaningless behind a proxy. The server-wide OFF cap still protects the upstream.
- **Self-service erasure.** `POST /auth/delete-account` removes the account and, through foreign keys, everything it owns. It is an account-level erasure the person asks for, so it is the one place rows are removed rather than tombstoned. Inactive accounts are kept; nothing expires them.
- **One device, several people.** The browser has one Dexie database, so a different account signing in clears the local tables first. Synced rows return on the next pull; unsynced outbox rows from the previous account are lost.

Rejected: invite codes and an admin role (needs a person to act). Email verification and reset (needs a mail service). A third-party CAPTCHA (a runtime third party and a tracker). A per-address signup limit (the app cannot see real addresses behind a proxy). `altcha-lib-go` (a dependency for about 100 lines of stdlib code). Passkeys (more moving parts; revisit later). A separate Dexie database per account (would let unsynced rows survive a switch; costs a larger change to the database provider).

Open: BLS import still targets one named account; moving it to shared reference data like the catalog is future work. Account-recovery by anything but a code is not planned.

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
| SQLite lock contention | Low | Medium | WAL, one writer, `BEGIN IMMEDIATE`, busy timeout, small per-account write volume |
| German compound search misses | Medium | Medium | Prefix search, MiniSearch fuzzy, trigram fallback, German fixtures |
| ODbL attribution/share-alike missed | Low | Medium | In-app attribution, license page, legal check before any DB redistribution |
| Browser storage eviction | Medium | High | `navigator.storage.persist()`, server source of truth, export reminders |
| Day rollover/timezone bugs | Medium | Medium | Explicit local date, configurable day start, DST and midnight tests |
| PWA update during a scan | Low | Medium | Prompt-based updates, defer while camera or sheet is active |
| Proxy or tunnel outage | Medium | High | App is unreachable while down; local logging continues if the PWA is installed |
| A proxy sign-in page replaces JSON | Low | Medium | Client detects a non-JSON response, keeps local data and offers "Sign in to continue" |
| Scope creep (OCR, menus, social) | High | Medium | Explicit non-goals; backlog only |

## Non-goals for v1

Restaurant menus, social features, shared households, native apps, push notifications, a German UI, full-text search of the entire OFF corpus, and offline access to uncached products.

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

### ADR-017 — Recipes, and weight and medication tracking
Decision (2026-11-20, user): recipes and ingredient math are in scope, and so is tracking body measurements and medication doses (GLP-1 style), which supersedes those two non-goals. Push notifications stay out.
- A recipe is a saved meal with a portion count. Nutrition is measured against the ingredients' combined weight, so no cooked weight is needed, and a recipe logs as one entry.
- Weight, waist, appetite, nausea and doses are one synced entity (`health_record`). The weight goal and the medication plan (name, days between doses, start date, doses on hand) are optional settings.
- The app records and reports what the person logged. It never suggests, changes or judges a dose, and it makes no clinical efficacy claim. Insights are the person's own data.
- Dose reminders are an in-app "due" card. A PWA cannot schedule reliable local notifications and web push needs a push service, which the no-third-party rule forbids.
- Health data follows the same rules as every other row: scoped by `user_id`, tombstoned on delete, in the backup export, never sent to a third party.

### ADR-018 — The Today summary leads with what was eaten
Decision (2026-11-20, user): the big number on Today is the calories eaten, with "left of goal" (or "over your goal") on one line under it. A big "left" number read as if it were what had been consumed. `mockups.html` is updated to match. The summary and every meal heading open a nutrition table (Day, Breakfast, Lunch, Dinner, Snacks): the day shows each nutrient against its goal, a meal shows each nutrient's share of the day.

### ADR-019 — Recipes are shared as copies
Decision (2026-11-20, user): recipes can be shared without any invite or account linking. Sharing produces a file or text that the other person imports into their own account as a new recipe. Nothing is hosted, linked or synced, and one account never reads another's rows, so the isolation rule and the "no sharing between accounts" non-goal are unchanged: this moves a copy by hand.


### ADR-020 — Community food corrections are shared reference data
Decision (2026-11-21, user): a wrong or missing nutrition value on a known product (a barcode in OFF or the catalog) is a fact about the product, not a custom food. A correction therefore applies to every account, and it is stored in the Open Food Facts shape so it can be pushed upstream later. This supersedes the per-account correction rule in ADR-007 (a user correction is never revalidated or overwritten) for products with a barcode; a custom food with no barcode, or one the person wants private, stays per-account.

- **Own table.** `product_facts` (current value per barcode) and `product_fact_revisions` (append-only history) are reference data like `catalog_foods`: no `user_id` on the value, never synced as client writes, never wiped by a catalog reimport. The contributor is stored as an opaque per-account id, kept (detached) when the account is deleted. Deleting an account does not remove its contributions: they are facts about products, not about the person.
- **OFF-compatible.** Fields use OFF's names and units (`code`, `product_name`, `brands`, `quantity`, `serving_size`, `nutrition_data_per=100g`, `energy-kj_100g`, `energy-kcal_100g`, `fat_100g`, `saturated-fat_100g`, `carbohydrates_100g`, `sugars_100g`, `fiber_100g`, `proteins_100g`, `salt_100g`). A missing value is absent, never 0. Each revision records its source (`manual` or `ocr`), the app version, the time and an optional cropped label photo. Nothing is sent to OFF in this decision: `make off-export` writes the file, a later ADR decides on pushing.
- **Trust.** There is no administrator. Decision (2026-11-21, user): a submission whose numbers pass the plausibility checks (energy within 15% of 4P + 4C + 9F + 2 fibre, saturates ≤ fat, sugars ≤ carbohydrate, macros sum ≤ 100 g, kJ and kcal agree) goes live for every account at once and replaces what was served, whether it was typed or read from a label photo. A submission that fails a check is stored but stays private to its author, with the failed checks named. A photo is optional evidence that makes a later push to OFF possible, not a condition. A quorum of two matching accounts was considered and dropped: with open signup and few accounts it would rarely form, and two throwaway accounts pass it. Protection is the checks, per-account caps (50 submissions a day, 500 in total), the append-only revision history, and a dispute: two accounts other than the contributor return the product to its previous revision (or to what OFF and the catalog say). Accepted risk: someone can submit a plausible wrong value that stays up until two others dispute it.
- **Unknown products.** A barcode that no source knows can be added through the same path (name, brand, quantity, nutrition). It becomes a fact for that barcode, visible to every account, under the same trust rules. A fact for a barcode OFF does not have is still OFF-shaped, so it is a candidate for a new OFF product later.
- **Lookup order.** user's own live food → accepted `product_facts` → `catalog_foods` → OFF → manual. OFF refresh and catalog reimport never overwrite an accepted fact. When a refresh returns OFF values within 2% of the fact, the fact is marked upstream-confirmed and stops overriding.
- **Reaching existing users.** Accepting a fact rewrites each account's server-managed `foods` row for that barcode (sources `off`, `catalog`) through the change log, so devices pull it. Entries keep their snapshot; history never changes. A person's own custom food for the barcode is left alone.
- **Photo OCR leaves the non-goals.** See ADR-021.

### ADR-021 — Nutrition table OCR runs on the device
Decision (2026-11-21, user): a person can photograph a nutrition table and get the values parsed. The photo is read in the browser with a self-hosted OCR engine (WASM and language data served by us, no CDN, no third-party service). The parser is a pure TypeScript module with a fixture corpus. OCR output is never saved unseen: every value is shown against the photo, low-confidence or check-failing values are highlighted, and the person confirms. A value the parser cannot read stays missing. A per-serving column is used only when the serving weight is known and no per-100 g column exists.

### ADR-022 — Generic West African foods are shared reference data
Decision (2026-11-22, user): foods without a barcode that people eat daily and that Open Food Facts does not describe (egusi, ogbono, okra, plantain and the other ingredients of Nigerian soups) come from a published food composition table, not from guesses. The first source is the FAO/INFOODS West African table (WAFCT 2019), trimmed to the foods a person weighs (702 of 1,028, per 100 g edible portion), plus 42 USDA FoodData Central foods (public domain) for what the FAO table lacks.

- **Own table.** `reference_foods` has the shape of `catalog_foods` with a text id (`wafct:02_005`) instead of a barcode, plus local names and a scientific name for search. It is reference data: no `user_id`, never synced, replaced wholesale on import, never part of the logical export.
- **Same food model.** Selecting a reference food adds one `foods` row to that account (source `catalog`, no barcode, `source_id` the reference id), so entries keep their snapshot and nothing downstream changes. A food an account already selected is not listed twice.
- **No invented values.** A missing nutrient stays NULL; `tr` (trace) is 0; a row without usable energy is skipped. Brackets in the source mark another analytical method and are dropped. Rows calculated from other foods are flagged `estimated`. A food the table lacks (ugu, stockfish) is not mapped to a different plant or fish; local names are mapped only to the same food.
- **Licence.** FAO allows use "in non-commercial products or services" with acknowledgement and reserves adaptation and commercial rights. Decision (2026-11-22, user): ship the cleaned table in the repository (`internal/food/data/wafct_2019.csv`, embedded in the binary, with `NOTICE.md`) so every deployment has it without an import step. The condition stays: non-commercial use, the credit in About and every export, and FAO's permission before anything is sold or the file is redistributed beyond personal, research or teaching use. See `docs/attribution.md`.
- **Offline.** A reference food that was never selected needs the server once; after that it is a normal local food.
- **Scope.** Only foods a person weighs (stall, butcher, market). Prepared dishes, beverages and packaged variants are left out because packaged goods carry a barcode and come from Open Food Facts, whose name search falls back to every country when the German results are thin.
- **USDA.** `usda_sr_legacy.csv` holds foods the FAO table lacks, from USDA FoodData Central SR Legacy (CC0), by exact description in `tools/usda/foods.go`. FAO comes first for West African foods; no food is in both.
- **Later.** The same table can take other sources behind the same `ref_id` scheme, and BLS can move here from its one-account import.

## ADR: Goal suggestions (2026-11-22)

Decision (user): Settings offers "Suggest my goals", a calorie and macro starting point from Mifflin-St Jeor, an activity factor and a weekly pace. No BMI or ethnicity term. The person always accepts it; it never writes goals itself. Sex, birth year, height, activity and pace stay device-local in Dexie meta (not synced), and weight comes from health records. Adults only; maintenance only when a medication plan is set. Built without a mockup at the user's request; refine in the app.
