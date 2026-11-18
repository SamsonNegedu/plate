# Runbook

Operate Plate with Docker Compose. The app is one binary, one SQLite file, and no external queue or cache. Put your own HTTPS proxy or tunnel in front; the app password is the only gate. Cloudflare Tunnel remains documented in `docs/cloudflare.md`.

## Files and ports

| Item | Default |
|---|---|
| Binary | `/plate` in the image |
| Data directory | `/data` (the `plate-data` volume) |
| Database | `<data>/plate.db` |
| Pre-migration snapshots | `<data>/snapshots/pre-migrate-<timestamp>.db` |
| HTTP listener | `:8080`, reached by your proxy or tunnel |
| Health | `/healthz` (process up), `/readyz` (migrations and writes ready) |
| Catalog seed in the image | `/seed/off-catalog.db` |

Expose the app over HTTPS only. Keep the database port and files off the network.

## First deploy with Docker Compose

1. Copy the environment template and fill it in:

   ```
   cp .env.example .env
   chmod 600 .env
   ```

   Required: `PLATE_BASE_URL=https://<host>` and a 12+ character `PLATE_ADMIN_PASSWORD` with `PLATE_ADMIN_EMAIL` for the first boot.

2. Set a real OFF contact in `PLATE_OFF_USER_AGENT`, for example `Plate/1.0 (you@example.com)`.

3. The image already contains the catalog seed at `/seed/off-catalog.db`. It is imported automatically when the catalog is empty, so the first boot takes a little longer and needs no extra setting. Confirm the log line `catalog import finished`.

4. Put the app behind an HTTPS proxy or tunnel. The app never trusts forwarded headers, so every request appears to come from the proxy: the 5-per-minute login limit by address is shared, and the per-account limit still applies.

5. Start and check:

   ```
   docker compose up -d
   docker compose ps
   docker compose logs -f plate
   curl -fsS https://<host>/readyz
   ```

6. Once the user exists, the bootstrap variables are ignored. You can remove `PLATE_ADMIN_PASSWORD` and `PLATE_ADMIN_EMAIL` from `.env` the next time you edit it; there is no need to restart or redeploy just for that. The app logs a warning if they are still present.

7. Verify login, a scan, and an entry over HTTPS from a phone.

## Status and logs

```
docker compose ps
docker compose logs --since 15m plate
```

Logs are JSON on stdout. Request logs contain method, path, status, duration, and request id. They never contain bodies, cookies, passwords, or session tokens.

`/readyz` is the gate: it returns non-200 while a migration is pending or the database cannot be written. Restarting does not fix a failed migration; read the log and restore the pre-migration snapshot.

## Backups

Two things protect the data, and neither is a scheduled job: you run them.

- **Export a backup** (Settings, "Export a backup") downloads a complete JSON copy of your entries, foods, saved meals and goals. It works from any device and restores with "Import a backup", which replaces the account's data after taking a server snapshot first. Do this regularly and keep the file off the host.
- **A copy of the database file.** Stop the app, copy `plate.db` from the volume, start it again. Do not copy it while the app runs.

```
docker compose stop plate
docker run --rm -v plate-data:/data -v "$PWD/backups":/backup alpine \
  cp /data/plate.db "/backup/plate-$(date +%Y%m%d).db"
docker compose start plate
```

The server also writes snapshots on its own, but only around risky changes: before applying a migration (`pre-migrate`) and before an import (`pre-import`), in `<data>/snapshots`. They are for rollback, not for backup. Copy backups off the host; a copy on the same disk is not a backup.

There is no scheduled snapshot, no replication, and no automatic off-host copy yet.

## Restore drill

Run before launch and monthly.

### From a snapshot

```
docker compose stop plate
docker run --rm -v plate-data:/data -v "$PWD/backups":/backup alpine \
  sh -c 'cp /backup/<snapshot>.db /data/plate.db && rm -f /data/plate.db-wal /data/plate.db-shm'
docker compose start plate
```

Verify `/readyz`, login, the known entry, and an export. To restore from an exported JSON file instead, use Settings, "Import a backup".

## Password reset and session revoke

One-shot startup flags. Set both, restart, confirm, then remove:

```
PLATE_ADMIN_RESET_PASSWORD=true
PLATE_ADMIN_PASSWORD=<new 12+ character password>
```

The reset revokes sessions. Every device must sign in again.

## Pause sync for all clients

```
PLATE_SYNC_ENABLED=false
```

Restart. `/api/v1/sync/meta` reports `enabled: false`; clients keep logging locally and the outbox grows. Remove the flag and restart to drain. Never delete the outbox or local data to work around a sync bug.

## Rebuild search

```
PLATE_REINDEX_FTS=true
```

Restart, confirm `reindex_fts` in the log, remove the flag, restart again.

## Re-import the catalog

A non-empty catalog is left alone on boot. To replace it, set the reimport flag for one boot:

```
PLATE_CATALOG_REIMPORT=true
```

Restart, confirm `catalog import finished` and the row count in `/api/v1/about`, then remove the flag. A bad or empty file leaves the previous catalog intact.

## Clear the image cache

Images live in `<data>/images`. Stop the app, remove that directory only, start the app. Never remove `plate.db`, `plate.db-wal`, or `plate.db-shm` while the app is running.

## Full disk

The app shows a storage banner in the client and refuses to drop writes silently. The server keeps `PRAGMA quick_check` on startup and prunes caches daily. Free space in this order:

1. Old pre-migration snapshots and manual copies.
2. `<data>/images` (safe, refetched from OFF).
3. Old off-host copies only after confirming the current snapshot restores.

If SQLite was interrupted, run `sqlite3 plate.db "PRAGMA quick_check"` and restore the newest good snapshot if it does not return `ok`.

## Upgrade

```
docker compose pull
docker compose up -d           # migrations run before the listener
curl -fsS https://<host>/readyz
```

Compose always runs `latest`. Every green push to `main` promotes the smoke-tested image to `latest` on ghcr.io (it is also kept as `sha-<commit>`) once the full CI passes. Tagging `vX.Y.Z` publishes a pinnable version for rollbacks. Check login, Today, scan, and sync.

## Rollback

1. `docker compose stop plate`
2. Restore the pre-upgrade snapshot if the migration was not backward compatible.
3. Change the `image:` line in `compose.yaml` to the previous version tag, then `docker compose up -d`. Put it back to `latest` once the fix ships.
4. Verify `/readyz` and a known entry.

## Rotate secrets

- **OFF contact:** update `PLATE_OFF_USER_AGENT`, restart.

## Alerts

Operate these outside the app; the app has no analytics and no third-party runtime service.

- Uptime check on `/healthz` every minute; alert after two consecutive failures.
- Disk space alert at 80%.
- Backup copy older than 24 hours.
- Weekly log review for 5xx spikes, OFF failures, and rate-limit hits.
