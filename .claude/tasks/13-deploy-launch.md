# Phase 12 — Deploy and launch

Status: blocked on Phase 11
Depends on: 11
Blocks: launch

## Goal

A fresh server can be deployed from the repository, restored from backup, and used daily on a phone without an operator babysitting it.

## Packaging

### Default: Docker Compose

One service:

1. `plate`: the static binary, non-root, data volume mounted at `/data`, `read_only: true` with `/data` writable. The catalog seed ships at `/seed/off-catalog.db`.

Compose health checks use `/healthz` and `/readyz` through the binary's `-healthcheck` flag. Logs go to stdout. No database port and no HTTP port are published to the host. Exposing the app and host-level supervision are handled by the operator; Cloudflare Tunnel remains documented in `docs/cloudflare.md`.

## Configuration and secrets

- `.env.example` documents every variable. `.env` is never committed.
- The tunnel token is a secret for cloudflared only; the Go process never reads it and `.env` does not contain it.
- `PLATE_BASE_URL` is the public HTTPS hostname.
- Bootstrap credentials are set once and used to create the user. Once the user exists they are ignored; removing them is recommended but needs no redeploy.
- The OFF `User-Agent` includes a real contact before public use.
- Secrets live in the host environment or a secrets file with `0600`, not in the image.
- The data directory is `0700` for the service user.
- The SQLite file, WAL, and SHM files are never served by the tunnel; only the app port is reachable by cloudflared.

## TLS and network

- Cloudflare terminates TLS and issues the public certificate. No origin certificate is installed.
- HSTS is enabled at Cloudflare after the first successful HTTPS response.
- No inbound 80/443 rule exists on the origin. cloudflared connects out only.
- Cloudflare Access covers the hostname with the operator's email and a 30-day session.
- The app keeps its own password session; a tunnel or Access misconfiguration does not expose the log.
- Cloudflare cache rules bypass `/api/*`, `/healthz`, and `/readyz`. Immutable build assets may be cached.
- A Cloudflare rate-limit rule on `/api/v1/auth/login` is a second layer in front of the app limiter.
- SSH is key-only and rate-limited. The host firewall denies all inbound except SSH.
- Do not create a DNS record that points directly at the origin. The tunnel is the only path.

## First deploy checklist

- [ ] Cloudflare zone is active and the tunnel is healthy.
- [ ] The public hostname resolves through Cloudflare and shows a valid certificate.
- [ ] Cloudflare Access allows the operator's email and blocks everyone else.
- [ ] No origin port is reachable directly; only cloudflared reaches the app.
- [ ] Data directory created and owned by the service user.
- [ ] Bootstrap user created; bootstrap password removed from env.
- [ ] Login works over HTTPS on desktop and phone.
- [ ] Camera permission and a scan work on the phone.
- [ ] OFF catalog seed auto-imported on first boot; dataset version and row count logged; ODbL attribution present.
- [ ] `/readyz` reports migrations complete.
- [ ] The first off-host snapshot exists and restores.
- [ ] A test entry survives a container restart.
- [ ] Logs show no secrets or stack traces.
- [ ] Security headers verified with `curl -I`.

## Migrations

- Run automatically at startup, before the listener.
- Before applying, write `VACUUM INTO data/snapshots/pre-migrate-<timestamp>.db`.
- If migration fails, exit non-zero and leave the previous binary able to start against the unchanged database.
- Production migrations are forward-only. Breaking changes use expand/contract:
  - Release N adds the new column/table and writes both.
  - Release N+1 reads the new shape and stops writing the old.
  - Release N+2 drops the old.
- `/readyz` fails while a migration is pending or a schema version mismatch is detected.

## Backups

### Snapshot

A nightly `VACUUM INTO` snapshot is kept locally for seven days and copied off the host. Pre-migration snapshots are kept for 30 days. There is no replication sidecar.

### Restore drill

Run monthly and before launch:

1. Copy the latest snapshot into a fresh container.
2. Start the new instance against the restored file.
3. Verify `/readyz`, login, a known entry, and an export.
4. Record the time to restore and any missing data.

A backup that has not been restored is not a backup.

## Upgrade and rollback

Upgrade:

1. Take a pre-upgrade snapshot.
2. Pull the new image or binary.
3. Start; migrations run; `/readyz` turns green.
4. Check login, Today, scan, and sync.
5. Keep the previous image tagged until the next successful backup.

Rollback:

1. Stop the service.
2. Restore the pre-upgrade snapshot if the migration was not backward compatible.
3. Start the previous image.
4. Verify.

Document the exact commands in `docs/runbook.md`.

## Observability

- Structured JSON logs to stdout; the platform collects them.
- Log request ID, method, path, status, duration. Never log bodies, cookies, passwords, or session tokens.
- Uptime check on `/healthz` every minute; alert after two failures.
- Disk space alert at 80%; backup copy older than 24 hours.
- Cloudflare Tunnel health alert; Access policy change alert.
- Cloudflare Web Analytics for edge errors; no client-side analytics.
- A weekly log review for 5xx spikes, OFF failures, and rate-limit hits.
- No APM or third-party analytics in the app.

## Operational actions without a CLI

Every host action is a one-shot startup flag: set it, restart, verify, remove it. No second binary, no subcommands.

| Action | Flag |
|---|---|
| Import BLS | `PLATE_IMPORT_BLS_PATH=/data/bls.csv` |
| Import OFF catalog seed | Automatic when the catalog is empty; `PLATE_CATALOG_REIMPORT=true` replaces it |
| Rebuild FTS | `PLATE_REINDEX_FTS=true` |
| Pause sync for all clients | `PLATE_SYNC_ENABLED=false` |
| Integrity check | `PLATE_INTEGRITY_CHECK=true` (default on; `false` skips startup check) |

Reset and import are idempotent and log one line. Remove the flag after the restart so a later restart does not repeat a destructive action.

## Maintenance

The process runs a daily in-process job at `PLATE_MAINTENANCE_HOUR`:

- `PRAGMA optimize` and `PRAGMA wal_checkpoint(TRUNCATE)`.
- Search-cache expiry and image-cache LRU eviction.
- Change-log retention and per-user `sync_state` refresh.
- Old `sync_ops` pruning.

It never runs during startup migrations and never blocks requests. A failure is logged and retried the next day; it does not crash the server.

## Runbook

`docs/runbook.md` must cover:

- Start, stop, restart, and check status.
- Confirm the tunnel is healthy and Access is enforcing the policy.
- Rotate the tunnel token and the Access policy without downtime.
- Restore from an off-host snapshot.
- Rotate the OFF contact and any R2 credentials.
- Recover from a full disk.
- Read the startup `PRAGMA quick_check` result and what to do if it fails.
- Re-run the BLS import with `PLATE_IMPORT_BLS_PATH`.
- Re-import the OFF catalog with `PLATE_CATALOG_REIMPORT=true` on one boot; record the new dataset version and row count.
- Verify the catalog is excluded from the logical export and client sync; snapshots still include the database file.
- Clear the image cache safely.
- Pause sync with `PLATE_SYNC_ENABLED=false` and confirm clients keep logging locally.
- Rebuild FTS with `PLATE_REINDEX_FTS=true`.
- Handle an Access-expired client: verify the client shows "Sign in to continue" and resumes sync after re-auth.

## Launch gates

- [ ] 14 consecutive days of personal use with no data loss.
- [ ] 50 German barcodes tested across Edeka, Rewe, Aldi, Lidl, Kaufland, dm, and Rossmann.
- [ ] The 200+ barcode corpus report by chain archived; at least 70% resolve locally at the 50k seed, 95% overall.
- [ ] English-only UI confirmed; no German localization in v1.
- [ ] Cloudflare Tunnel healthy; Access policy blocks non-operator emails; no origin port reachable.
- [ ] iOS and Android installed PWA passes the device checklist.
- [ ] Offline log → reconnect → second device convergence verified.
- [ ] Export, wipe, import, verify.
- [ ] Snapshot restore drill completed.
- [ ] Lighthouse and axe reports archived.
- [ ] Design parity sign-off recorded after Phases 8, 9, and 10; no unresolved P1/P2 design regression.
- [ ] `govulncheck`, `gosec`, and `pnpm audit` clean.
- [ ] Attribution for OFF (ODbL) and BLS visible in the app and export.
- [ ] Catalog seed version and row count recorded; ODbL attribution present.
- [ ] Runbook reviewed by someone other than the author, or read back step by step.

## Post-launch backlog

Only after the core loop is stable:

0. Import from Lose It or MyFitnessPal: a CSV/zip mapping UI for date, meal, name, kcal, and macros; dry-run summary; dedupe by date and name; never overwrite a non-empty day without confirmation. This is v1.1, not launch-blocking.
0b. Full offline product search: ship the top 5k–10k catalog rows to the client with wa-sqlite/OPFS, gated on a measured size and latency spike. v1 serves the catalog from the server.
1. Optional larger German OFF seed, if search coverage is the limiting factor.
2. Recipes and ingredient math.
3. Weight trend.
4. Passkeys.
5. Label OCR for missing products.
6. Barcode contribution back to Open Food Facts.

Each item needs its own phase file and a new architecture decision before implementation.

## Deliverables

- [ ] Dockerfile and compose with `plate`.
- [ ] `.env.example` and a secrets checklist.
- [ ] `docs/runbook.md` and `docs/attribution.md` (OFF ODbL, BLS).
- [ ] Snapshot backup policy and a completed restore drill.
- [ ] Uptime and disk alerts.
- [ ] Launch checklist completed.

## Acceptance

- A fresh deployment reaches a working login and scan over HTTPS from the checklist alone.
- A restore from backup produces a working instance with the expected data.
- An upgrade and a rollback both complete without data loss.
- The service runs for 14 days without manual intervention beyond normal use.
- An operator other than the author can follow the runbook.
