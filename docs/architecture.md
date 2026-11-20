# Architecture

Plate is an offline-first PWA for logging calories by barcode. A React client keeps its own database and works without a network; a Go server is the authority that orders writes, holds the food data, and serves the app.

```
 phone or browser (installed PWA)                         one Go binary + one SQLite file
┌─────────────────────────────────────────┐   HTTPS    ┌────────────────────────────────────────────┐
│ React UI: today, scan, history,         │  (a proxy  │ chi + Huma  /api/v1        embedded SPA    │
│   settings, and sheets                  │   or       │   auth    sessions, Argon2id, limits       │
│ Dexie (IndexedDB), the local truth:     │   tunnel   │   foods   barcode, search, images          │
│   entries, foods, savedMeals, outbox    │   you run) │   sync    push, pull, snapshot, meta       │
│ SyncEngine: one leader tab, backoff     │◄──────────►│ SQLite (WAL, FTS5): users, sessions,       │
│ Service worker: precache, offline shell │            │   foods, entries, change_log, catalog_foods│
└─────────────────────────────────────────┘            └──────────────────────┬─────────────────────┘
                                                                              │ long tail and refresh only
                                                                              ▼
                                                              Open Food Facts (never called by the browser)
```

## Principles the code enforces

- **Local first.** Dexie is the source of truth on a device. Logging works offline; writes queue in an outbox and sync later. The server decides ordering.
- **History never changes.** Every entry stores a snapshot of the nutrition it was logged with. Editing a food later does not rewrite old entries.
- **Missing is not zero.** An unknown nutrient is `NULL`. A food without calories cannot be logged. A per-serving value is never treated as per-100 g.
- **Deletes are tombstones.** Syncable rows are never hard-deleted, so a delete reaches every device and a stale edit cannot resurrect a row.
- **The browser never calls Open Food Facts.** All food and image traffic goes through the server, which also caches it.
- **Records, not advice.** Weight, body measurements and medication doses are logged and reported back as the person entered them. The app never suggests, changes or judges a dose, and its insights are the person's own data.
- **Accounts stay isolated.** Sharing a recipe moves a copy by file or text; nothing is linked or hosted, and one account never reads another's rows.
- **One binary, one file.** No queue, no cache server, no second database.

## A scan, end to end

1. The scan page asks the camera hook for a stream and feeds frames to a detector (the native `BarcodeDetector`, or a WASM decoder where it is missing).
2. A decoded code goes to `resolveBarcode` (`web/src/food/lookup.ts`): the local Dexie cache first, then `GET /api/v1/foods/barcode/{code}`.
3. The server answers from the user's own foods, then the bundled catalog seed (no network), then Open Food Facts, and normalizes whatever it gets. See [food-and-search.md](food-and-search.md).
4. The product sheet opens. Logging writes the entry with its nutrition snapshot and an outbox row in one Dexie transaction, and the screen reads the local row at once.
5. The sync engine pushes the outbox, then pulls changes. See [sync.md](sync.md).

## Where the code lives

| Path | What it is |
|---|---|
| `cmd/plate` | entrypoint, startup actions, graceful shutdown, the container health probe |
| `internal/config` | environment parsing and validation ([configuration.md](configuration.md)) |
| `internal/httpapi` | Huma operations, middleware, error mapping, the OpenAPI spec |
| `internal/auth` | sessions, password hashing, same-origin checks, login limits |
| `internal/store` | database open and migrate, transactions, sqlc output, daily maintenance |
| `internal/food` | Open Food Facts client, normalizer, catalog import, image proxy, search |
| `internal/search` | building safe FTS queries and ranking results |
| `internal/sync` | applying pushes, serving pulls and snapshots, restore |
| `internal/webui` | the embedded single-page app |
| `db/migrations`, `db/queries` | goose migrations and sqlc queries; generated code is never hand-edited |
| `web/src` | the client ([client.md](client.md)) |
| `tools/` | catalog builder, coverage corpus, e2e seed |

For what the app does feature by feature, see [features.md](features.md).

## Runtime shape

- The server listens on `PLATE_ADDR` (default `:8080`) and serves the API under `/api/v1`, the built app at every other path, and `/healthz` (process up) and `/readyz` (migrations done and the database writable).
- Startup order: open the database; snapshot it if migrations are pending, then migrate; run the integrity check (`PRAGMA quick_check`); prune expired sessions; run the one-shot imports (BLS, FTS rebuild) when requested; import the catalog seed if the catalog is empty; then listen.
- A daily in-process job (`PLATE_MAINTENANCE_HOUR`, default 3) runs `PRAGMA optimize`, truncates the WAL, expires the search cache, and prunes old change-log rows and applied-op records. The image cache is bounded when images are written: least-recently-used files are evicted past `PLATE_IMAGE_CACHE_MB`. It never blocks requests and a failure is logged and retried the next day.
- Pre-migration snapshots (`VACUUM INTO`) are written automatically. There is no scheduled backup job yet: copy snapshots off the host yourself ([runbook.md](runbook.md)).
- The container is a minimal Alpine image with only the binary, running non-root, runs read-only with all capabilities dropped, and publishes no port. HTTPS comes from a proxy or tunnel the operator runs in front.

## Quality gates

`make verify` runs golangci-lint, oxlint and oxfmt, the Go and Vitest suites, the build and a generated-files check. `make test-e2e` drives the real app in Playwright. `make docker-smoke` boots the production image and checks login, search, persistence across a restart, and the health probe. CI runs these in parallel; see `.github/workflows/ci.yml`.
