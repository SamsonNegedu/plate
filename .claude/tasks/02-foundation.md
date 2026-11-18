# Phase 1 — Foundation and tooling

Status: done (Phase 0 review pause waived by the user; A and E still manual)
Depends on: 0
Blocks: 2

## Goal

A repository that builds, tests, lints, runs locally, and produces one static binary with the SPA embedded. No product features yet.

## Repository layout

```
plate/
  cmd/plate/main.go
  internal/
    config/        env parsing, validation
    httpapi/       Huma operations, middleware, error mapping
    auth/          sessions, password, CSRF
    store/         sqlc-generated code, DB open, transactions
    food/          OFF client, normalizer, BLS importer
    search/        FTS query builder and ranking
    sync/          push/pull apply logic
    webui/         embedded SPA handler
  db/
    migrations/    goose SQL
    queries/       sqlc SQL
    schema.sql     optional dump used by sqlc if migration parsing drifts
  web/
    src/
    public/
    vite.config.ts
    package.json
  .claude/tasks/
  Makefile
  Dockerfile
  compose.yaml
  docs/cloudflare.md
  .env.example
  go.mod
```

## Tooling decisions

- Go: current stable at kickoff. Use `go tool` directives in `go.mod` to pin sqlc and goose. No global installs in CI.
- Node: current LTS. pnpm with a committed lockfile.
- Frontend: Vite, React, TypeScript strict, React Router 7, Dexie, Zustand, RHF + Zod, Radix, Recharts, MiniSearch, `barcode-detector`, `zxing-wasm`, `vite-plugin-pwa`, `openapi-typescript`, `openapi-fetch`.
- Lint/format: `golangci-lint` for Go; Biome for the web. One command each.
- Tests: `go test`, Vitest, React Testing Library, Playwright. Playwright is wired but scans are mocked until Phase 8.
- Security: `govulncheck`, `gosec` (via golangci), `pnpm audit`, lockfiles, SBOM generation.
- Container: multi-stage, `CGO_ENABLED=0`, distroless/static, non-root, data dir mounted.

## Configuration

Environment only, validated at startup, fail fast with a readable error.

| Variable | Default | Notes |
|---|---|---|
| `PLATE_ADDR` | `:8080` | HTTP listen address |
| `PLATE_DATA_DIR` | `./data` | DB, images, snapshots |
| `PLATE_DB_PATH` | `$DATA_DIR/plate.db` | SQLite file |
| `PLATE_BASE_URL` | `http://localhost:8080` | Public HTTPS URL behind Cloudflare; used for cookie origin checks |
| `PLATE_TRUST_PROXY` | `false` | `true` behind cloudflared |
| `PLATE_PROXY_CIDRS` | empty | cloudflared network CIDR; required when trust is on |
| `PLATE_ADMIN_EMAIL` | none | First-run bootstrap |
| `PLATE_ADMIN_PASSWORD` | none | First-run bootstrap; never logged |
| `PLATE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `PLATE_AUTH_MODE` | `password` | `password` or `proxy` |
| `PLATE_ADMIN_RESET_PASSWORD` | `false` | One-shot reset using `PLATE_ADMIN_PASSWORD`, then revoke sessions |
| `PLATE_SYNC_ENABLED` | `true` | Set `false` to pause sync server-side |
| `PLATE_REINDEX_FTS` | `false` | One-shot FTS rebuild on startup |
| `PLATE_IMPORT_BLS_PATH` | empty | One-shot BLS import from a local file |
| `PLATE_IMPORT_CATALOG_PATH` | empty | OFF catalog seed, imported only when the catalog is empty |
| `PLATE_CATALOG_DATASET_VERSION` | file mtime | Snapshot label stored with the catalog |
| `PLATE_INTEGRITY_CHECK` | `true` | Run `PRAGMA quick_check` at startup |
| `PLATE_MAINTENANCE_HOUR` | `3` | Local hour for optimize and prune jobs |
| `PLATE_TRUST_PROXY` | `false` | Required for proxy auth |
| `PLATE_PROXY_CIDRS` | empty | Allowlist for proxy auth |
| `PLATE_OFF_BASE_URL` | `https://world.openfoodfacts.org` | Test override |
| `PLATE_OFF_SEARCH_URL` | `https://search.openfoodfacts.org` | Test override |
| `PLATE_OFF_USER_AGENT` | `Plate/1.0 (self-hosted)` | Set a real contact before public use |
| `PLATE_IMAGE_MAX_BYTES` | `2000000` | Per-image cap |
| `PLATE_IMAGE_CACHE_MB` | `256` | Disk cache bound |

## Server skeleton

- `main` wires config, logger, DB, migrations, stores, services, HTTP.
- Startup actions run before the listener: bootstrap user, one-shot password reset, one-shot FTS rebuild, one-shot BLS import, one-shot OFF catalog import, and `PRAGMA quick_check`. Each action logs a single line and then the flag is ignored for the rest of the process lifetime.
- A daily maintenance job runs `PRAGMA optimize`, `PRAGMA wal_checkpoint(TRUNCATE)`, search-cache pruning, image-cache LRU eviction, and change-log retention. It is in-process, has a context, and logs counts.
- `slog` JSON to stdout. Request middleware adds `request_id`, method, path, status, duration. No product names or credentials in logs.
- Panic recovery middleware returning a problem response.
- `http.Server` with `ReadHeaderTimeout`, `IdleTimeout`, `WriteTimeout`; graceful shutdown on SIGINT/SIGTERM with a 10 s drain.
- `/healthz` is process-only. `/readyz` checks DB ping and migration state.
- Security headers middleware: CSP, HSTS (when HTTPS), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`.
- Body limits via `http.MaxBytesReader` on API routes.

## Frontend skeleton

- Vite dev server proxies `/api` to `:8080`.
- Production build outputs `web/dist`; `internal/webui` embeds it with `//go:embed`.
- If `web/dist` is missing in a non-production build, serve a clear message pointing at `make dev-web`.
- `vite-plugin-pwa` is configured but its offline behavior is finished in Phase 10.
- Fonts are self-hosted. No Google Fonts request at runtime.
- English only. All user-facing copy lives in `src/lib/copy.ts`; no i18n framework and no scattered literals. German product names keep their spelling.

## Cloudflare edge

- `compose.yaml` runs one service: `plate`, with no published port.
- cloudflared is run by the operator when used; it is documented in `docs/cloudflare.md`, not shipped in compose.
- The Go process binds `:8080` inside the container network and is reached by the operator's proxy or tunnel.
- `PLATE_TRUST_PROXY=true` and `PLATE_PROXY_CIDRS` cover the cloudflared network. The app reads `CF-Connecting-IP` only from that CIDR.
- `PLATE_BASE_URL` is the public `https://` hostname.
- `docs/cloudflare.md` documents the Access application, the email policy, the 30-day session, and cache bypass rules for `/api/*`, `/healthz`, and `/readyz`.
- Cloudflare cache rules never cache authenticated HTML or API responses; immutable build assets may be cached at the edge.

## Makefile targets

```
make dev          # Go + Vite together
make dev-api      # Go only
make dev-web      # Vite only
make build        # web build + static Go binary
make test         # go test + vitest
make test-e2e     # playwright
make lint         # golangci-lint + biome
make fmt          # gofmt + biome format
make generate     # sqlc + openapi TS types
make sqlc-diff    # fails if generated code is stale
make coverage     # German barcode corpus, fixture mode
make coverage-live# manual, hits OFF within rate limits
make catalog      # build the German OFF seed (release artifact)
make migrate-up
make migrate-down
make migrate-status
make backup       # VACUUM INTO data/snapshots/<ts>.db
make verify       # lint + test + build + sqlc-diff + generated diff
```

## CI

- Go job: `go test ./...`, `golangci-lint`, `govulncheck`, `sqlc diff`, build.
- Web job: install with lockfile, `biome ci`, `vitest run`, `vite build`.
- Integration job: Playwright against the built binary with a temp data dir.
- Artifact: the linux/amd64 binary and the web build.
- Cache Go modules, pnpm store, Playwright browsers.
- Fail on a dirty generated-code diff.

## Deliverables

- [x] Repository layout and `go.mod` with pinned tools.
- [x] `web/` app scaffold with strict TypeScript and the design tokens from the mockups.
- [x] Config, logging, health, security headers, graceful shutdown.
- [ ] Startup actions for bootstrap, password reset, and FTS rebuild; daily maintenance job. Framework, integrity check and core maintenance jobs done; bootstrap and reset land in Phase 3, FTS rebuild in Phase 2 (they need the schema).
- [x] English copy module in the web app.
- [x] SQLite open helper with WAL and `BEGIN IMMEDIATE` transaction helper.
- [x] Embedded SPA handler and dev proxy.
- [x] Makefile and CI workflows.
- [x] Dockerfile, compose with `plate`, `.env.example`.
- [x] `docs/cloudflare.md` for the tunnel, Access policy, and cache rules.
- [x] `CLAUDE.md`, the guardrail skills in `.claude/skills/`, and `.claude/settings.json`.
- [x] `README.md` with local setup and the phase pointer.

## Verification

- `make dev` serves the SPA on Vite and the API on Go.
- `make build` produces one binary; running it serves the SPA and `/healthz`.
- `make verify` passes from a clean checkout.
- Deleting `web/dist` and running the binary gives a clear dev message, not a panic.
- `CGO_ENABLED=0 go build` succeeds for darwin/arm64 and linux/amd64.

## Out of scope

Any product table, auth, food lookup, sync, or application UI beyond a placeholder shell.

## Exit criteria

A new contributor can clone, run `make dev`, and reach a placeholder page with a working API health check in under ten minutes.

## Dependencies

All web and Go dependencies come from the locked stack table in `CLAUDE.md`, except `golangci-lint` and `govulncheck` (named in this file) and `fake-indexeddb` (Dexie tests in jsdom). `react-router` is pinned to 7 because the plan locks it; the registry default is now 8.

## Note

Verified: `make verify` exits 0 (golangci-lint 0 issues, Go and Vitest tests, build, typecheck, Biome); the built binary serves `/healthz`, `/readyz`, security headers, SPA fallback, JSON 404 for unknown API routes, and the OpenAPI document; Playwright passes on 400 px and desktop; `CGO_ENABLED=0` builds for darwin/arm64 and linux/amd64.

Not verified: `make dev` end to end (Vite proxy), `docker build` and `docker compose up`, the CI workflow on a real runner, and `make audit` (govulncheck and pnpm audit not run).

Follow-up resolved: the legacy prototype and its `vendor/` folder were removed, so bare `go` commands work.
