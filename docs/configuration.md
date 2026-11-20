# Configuration

The server reads environment variables (`internal/config/config.go`) and refuses to start on an invalid value, printing every problem at once. `.env.example` lists the ones you normally set; `docker compose` and `make dev` both read `.env`. Every variable not marked required has a working default.

## You normally set these

| Variable | Default | Purpose |
|---|---|---|
| `PLATE_BASE_URL` | `http://localhost:8080` | **Required in production.** The public URL. Must be `https` except on localhost. Used for cookie scope and same-origin checks |
| `PLATE_SIGNUP_ENABLED` | `true` | `false` closes signup; existing accounts keep working. There is no first-boot account to create |
| `PLATE_OFF_USER_AGENT` | `Plate/1.0 (self-hosted)` | Identifies this server to Open Food Facts. Put a real contact |
| `PLATE_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `PLATE_SYNC_ENABLED` | `true` | `false` pauses sync for every client; they keep logging locally |

## One-shot host actions

Set, restart, confirm in the log, then remove. A restart with the flag still set repeats the action. None of them is needed to run the app or to add people, and none can reach into an account.

| Variable | Action |
|---|---|
| `PLATE_CATALOG_REIMPORT` | Replace the catalog with the seed again |
| `PLATE_REINDEX_FTS` | Rebuild the search indexes |
| `PLATE_IMPORT_BLS_PATH`, `PLATE_IMPORT_BLS_USERNAME` | Import BLS generic foods from this file into that account |
| `PLATE_IMPORT_CATALOG_PATH` | Import the catalog from this file instead of the bundled seed |

## Tuning and paths

| Variable | Default | Purpose |
|---|---|---|
| `PLATE_ADDR` | `:8080` | Listen address |
| `PLATE_DATA_DIR` | `./data` (`/data` in the image) | Database, images and snapshots |
| `PLATE_DB_PATH` | `<data dir>/plate.db` | The SQLite file |
| `PLATE_INTEGRITY_CHECK` | `true` | Run `PRAGMA quick_check` at startup; the server refuses to start if it fails |
| `PLATE_MAINTENANCE_HOUR` | `3` | Hour (0 to 23) for the daily maintenance job |
| `PLATE_IMAGE_CACHE_MB` | `256` | Bound on the product image cache |
| `PLATE_SIGNUP_POW_BITS` | `17` | Base proof-of-work difficulty for signup (0 to 28 zero bits). Each extra bit doubles the work; 0 turns it off, which tests use |
| `PLATE_OFF_BASE_URL`, `PLATE_OFF_SEARCH_URL` | the Open Food Facts hosts | Overrides, used by tests |
| `PLATE_HEALTHCHECK_URL` | the local `/readyz` | Read only by `plate -healthcheck`, the container health probe |

Test-only variables (`PLATE_COVERAGE_SEED`, `PLATE_COVERAGE_REPORT`, `PLATE_TEST_BLS_FILE`) are read by test code, not by the server.

## What compose sets

`compose.yaml` passes the first table, `PLATE_CATALOG_REIMPORT` from `.env`, mounts the `plate-data` volume at `/data`, and runs the image read-only with no published port. See [runbook.md](runbook.md).
