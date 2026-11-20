# Sync

A device writes locally first and syncs in the background. The server is the authority on order. Code: `web/src/sync` (client) and `internal/sync` (server); the wire types are in `internal/sync/protocol.go` and the endpoints are in [api.md](api.md).

## What syncs

Six entities: `entry`, `food` (custom foods and corrections), `settings` (which also carries the optional weight goal and medication plan), `saved_meal` (a recipe with its ingredients and `servings`, replaced as one unit; the wire name predates recipes and stays), `favorite` and `health_record` (a weight, a body measurement, an appetite or nausea rating, or a medication dose). Foods that come from Open Food Facts, BLS or the catalog are server-managed and never travel as client writes.

## Writing on the device

Every mutation runs in one Dexie transaction that writes the row and an **outbox** row with a fresh UUIDv7 `op_id` (`web/src/db/*.ts`, `outbox.ts`). The screen reads the local row at once, so the day total comes from local entries, never from a server total. Nothing waits for the network.

## Pushing

The engine (`SyncEngine`) syncs on app start, when the browser comes back `online`, when the tab becomes visible, every 60 s while visible, and 800 ms after the last local write (so a burst of edits is one request). Only one tab drains at a time: `navigator.locks` elects a leader, and where Web Locks is missing a 15 s lease row in Dexie does the same job.

One cycle: ask `GET /sync/meta` (cheap; proves the server is reachable and tells an outage from the kill switch), then repeat up to four rounds of *push the outbox in batches of 100, then pull*, until nothing is pending.

On the server (`POST /sync/push`, `internal/sync/push.go`):

- A batch is one `BEGIN IMMEDIATE` transaction with a savepoint per op, so one bad op rolls back only itself.
- A repeated `op_id` returns its recorded result as `duplicate`. This is what makes retries safe.
- Each op is validated at the boundary (unknown fields are rejected, bodies over 256 KB are refused, a batch holds at most 100 ops). A bad op is `rejected` with field errors and never blocks the others.
- A successful op appends to the user's `change_log`, stores its result in `sync_ops`, and returns the new `server_seq`.

Per-op results the client handles:

| Status | Meaning | Client does |
|---|---|---|
| `applied` | written | deletes the outbox row |
| `duplicate` | already applied earlier | deletes the outbox row |
| `tombstoned` | the row was deleted on the server; the write is not applied | deletes the outbox row and marks the local row deleted |
| `rejected` | failed validation | keeps the row as `failed`; Settings lists it to retry or discard |

## Pulling

`GET /sync/pull?since=<cursor>` returns changes with `seq` greater than the cursor, oldest first, up to 500 per page, with `next` and `has_more`. The client applies a page in one Dexie transaction and moves its cursor. A change is the full row for an upsert, or just `{deleted_at}` for a delete.

## Conflicts

There is no merge. The last write the server receives wins. If an upsert carries a `base_seq` and the stored row had moved past it, the op still applies but the result says `conflict: true`; the client records it in its `conflicts` table and Settings shows the count. A write to a row that was deleted is not applied (it comes back `tombstoned`), so a stale edit cannot resurrect a deleted entry.

## New devices and gaps

A new device calls `GET /sync/snapshot` (every live row plus a cursor), stores it, and then pulls deltas. Change-log rows older than 180 days are pruned and each user's `min_seq` moves up (`sync_state`); a device whose cursor is below `min_seq` gets a `ResyncError` and must snapshot again.

A re-snapshot never loses unsynced work. In one transaction the client keeps every row that still has an outbox op, replaces the rest with the snapshot, gives held ops fresh `op_id`s, and first stores a rescue copy of local data in `meta` (the last three are kept).

## Failure handling

| What happened | State shown | Next |
|---|---|---|
| network error | `offline` | retry with backoff 1, 2, 4, 8, 16, 30, 60 s (with ±20 % jitter); coming back `online` retries at once |
| 5xx or other error | `error` | same backoff |
| 401 | `auth` | pause and ask for the password; local data stays |
| the server kill switch (`PLATE_SYNC_ENABLED=false`) | `paused` | back off; the app keeps logging locally |
| a proxy returns an HTML page instead of JSON | `access` | "Sign in to continue"; resumes after re-authentication |
| cursor below `min_seq` | (transient) | snapshot, then run the cycle again |

The badge in the app bar (`SyncBadge`) always shows the real state: pending beats synced, errors beat pending.

## Rows that refer to other rows

The outbox drains in the order the ops were created, and the server rejects a row that refers to something it has not seen (a recipe or entry naming a food that has not arrived). Anything that writes a food and the rows that use it, such as the dev sample data, must stamp the food earlier than the rows that refer to it.

## Backup is separate

`GET /export` returns a complete JSON backup at any time, independent of sync, and `POST /import` replaces the account's data with one (an old server snapshot is taken first). See [runbook.md](runbook.md).

## Tests

`web/src/sync/engine.test.ts` and `convergence.test.ts` cover the engine and two-client convergence; `internal/sync/*_test.go` cover idempotent replay, tombstones, validation and pull retention.
