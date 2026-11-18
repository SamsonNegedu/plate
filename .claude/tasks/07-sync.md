# Phase 6 — Sync engine

Status: done
Depends on: 4, 5
Blocks: 8, 9

## Goal

Logging on a phone in a supermarket basement, then opening the app on a laptop, must converge without duplicates, lost rows, or a spinner that never ends. The protocol is small enough to reason about and tested against the failure cases that actually happen.

## Principles

- The client is optimistic. The server is authoritative for order.
- Every row has a client-generated UUIDv7. Creates are idempotent by ID.
- Every mutation has an `op_id` (UUIDv7). The server records applied IDs.
- The server's change log is the only source of pull order. Client clocks never order writes.
- Deletes are tombstones.
- Conflicts are entity-level last-write-wins by server receive order. This is a single-user app; field-level merging is not worth the complexity.

## Syncable entities

| Entity | Operations | Notes |
|---|---|---|
| `entry` | upsert, delete | Full nutrition snapshot travels with the row |
| `food` | upsert, delete | Only `source='user'` foods; OFF/BLS/catalog rows are server-managed |
| `settings` | upsert | One row per user; id is the user id |
| `saved_meal` | upsert, delete | Items are nested in the payload and replaced atomically |
| `favorite` | add, remove | `id` is the food id |

Non-syncable: sessions, change log, sync ops, search cache, image cache, OFF/BLS/catalog caches.

## Server endpoints

### `POST /api/v1/sync/push`

Request:

```
{
  "client_id": "uuid",
  "ops": [
    {
      "op_id": "uuidv7",
      "entity": "entry",
      "type": "upsert",
      "id": "uuidv7",
      "base_seq": 123,
      "client_ts": "2026-11-12T20:14:03Z",
      "data": { ... }
    }
  ]
}
```

Rules:

- Batch limit 100 ops; body limit 1 MB.
- Validate the session and user first.
- One transaction, with a savepoint per op. A rejected op rolls back only itself; the rest apply.
- For each op: if `op_id` exists in `sync_ops`, return the stored result as `duplicate` without applying.
- `base_seq` is optional and used only to report a conflict; it never blocks the write.
- Apply, set `updated_at` to server time, append a change-log row, set `server_seq`, insert `sync_ops`.
- If the entity is tombstoned and the op is an upsert, return `tombstoned` with the tombstone. No resurrection.
- If the op fails validation, return `rejected` with a problem detail for that op.
- A conflict is `applied` with `"conflict": true` when the existing row's `server_seq` is newer than `base_seq`. The client records it locally.

Response:

```
{
  "results": [
    { "op_id": "...", "status": "applied", "server_seq": 124, "conflict": false },
    { "op_id": "...", "status": "duplicate", "server_seq": 122 },
    { "op_id": "...", "status": "rejected", "problem": { ... } }
  ],
  "cursor": 124
}
```

### `GET /api/v1/sync/pull?since=<seq>&limit=500`

Response:

```
{
  "changes": [
    { "seq": 124, "entity": "entry", "id": "...", "op": "upsert", "data": { ... } }
  ],
  "next": 125,
  "has_more": false
}
```

- `limit` max 500.
- Ordered by `seq` ascending.
- `data` is the full row for upserts and `{ "deleted_at": "..." }` for deletes.
- If `since` is below the user's `min_seq`, return `409 resync_required` with the current `min_seq`.

### `GET /api/v1/sync/snapshot`

Returns all live rows for the user, plus `cursor` and the user's `min_seq`. Includes settings, foods with `source='user'`, entries, saved meals with items, and favorites. Does not include the OFF/BLS/catalog cache or tombstones older than the cursor.

### `GET /api/v1/sync/meta`

Returns `{ enabled, head, min_seq, server_time }`. The client uses it to detect a retention gap, to show "last synced", and to distinguish a server kill switch from a network failure.

## Client model

Dexie tables:

| Table | Indexes |
|---|---|
| `entries` | `id`, `eatenOn`, `meal`, `[eatenOn+meal]`, `foodId`, `serverSeq`, `updatedAt`, `deletedAt` |
| `foods` | `id`, `&barcode`, `searchName`, `source`, `serverSeq`, `deletedAt` |
| `settings` | `userId` |
| `savedMeals` | `id`, `serverSeq`, `deletedAt` |
| `savedMealItems` | `id`, `savedMealId`, `foodId` |
| `favorites` | `foodId` |
| `outbox` | `++id`, `opId`, `entity`, `entityId`, `status`, `nextAttemptAt` |
| `meta` | `key` |
| `conflicts` | `++id`, `at`, `entity`, `entityId`, `serverSeq` |

Outbox states: `pending`, `inflight`, `failed`. On startup, every `inflight` row returns to `pending`; this makes a crash mid-request safe. `failed` rows remain visible in Settings and can be retried or discarded; they never block other ops.

Local write transaction:

1. Apply the optimistic row.
2. Insert the outbox op.
3. For a delete, keep the row with `deletedAt` and enqueue the delete op.
4. Broadcast `changed` to other tabs.
5. Schedule a drain after 800 ms.

## Pull application

For each page, in one Dexie transaction:

- If `change.seq <= meta.cursor`, skip.
- `upsert`: `put` the row. For `settings`, replace the single row. For `saved_meal`, replace the meal and its items.
- `delete`: set `deletedAt` and keep the row.
- `favorite` remove: delete the favorite.
- Advance `meta.cursor` to `next` in the same transaction.

If the transaction fails, the cursor does not advance and the page is retried. Reapplying is safe because rows are keyed by ID and seq.

## Push and pull cycle

1. Drain outbox in `createdAt` order, 100 ops at a time.
2. On a successful push, remove `applied` and `duplicate` ops; record conflicts; leave `rejected` and `failed` for Settings.
3. Pull from the current cursor until `has_more` is false.
4. Update `meta.lastSyncedAt` and broadcast.
5. Repeat push if new ops arrived during the pull.

If push fails with 401, pause and show the login sheet. If it fails with 409 `resync_required`, discard local sync state, take a snapshot, and reapply pending user ops carefully (see below).

## Resync after retention gap

A client below the user's `min_seq` cannot trust its local view. The client:

1. Exports a local rescue file (automatic, to IndexedDB) containing pending ops and local rows.
2. Takes a snapshot and replaces local synced tables.
3. Re-enqueues pending user ops that are not already represented in the snapshot, with new `op_id`s but the same entity IDs where possible.
4. Shows a "Resynced from server" notice.

This path is rare but must be tested.

## Triggers, backoff, and leadership

Triggers:

- 800 ms after a local mutation.
- App start.
- `online` event.
- `visibilitychange` to visible.
- Every 60 s while visible.
- Manual "Sync now" in Settings.

Backoff: 1, 2, 4, 8, 16, 30, 60 s with ±20% jitter. Persist `nextAttemptAt`. Reset on success.

Leadership:

- `navigator.locks.request("plate-sync", { mode: "exclusive" }, drain)` so only one tab pushes.
- BroadcastChannel `plate-sync` with `{ type: "changed" }` after pulls; other tabs re-read Dexie.
- Fallback: a `meta.leaderUntil` lease in Dexie renewed every 10 s; a tab claims a 15 s lease. If Web Locks and BroadcastChannel are both absent, sync still works; duplicate pushes are idempotent.

Online detection:

- Do not trust `navigator.onLine` alone.
- Treat a failed fetch as offline; treat a successful `/sync/meta` as online.
- The UI shows `Offline`, `Syncing`, `Pending N`, `Error`, or `Synced <time>`.

## Undo and deletes

- Delete toasts last 5 s.
- If the delete is still pending in the outbox, cancel the op and undelete locally.
- If the delete has synced, undo creates a new entry with a new ID. The tombstone remains.
- No server resurrection path in v1.

## Sync kill switch

`PLATE_SYNC_ENABLED=false` makes every sync route return `503 sync_disabled`. The client:

- Keeps logging locally; the outbox keeps growing.
- Shows "Sync paused by server" in Settings and the sync badge.
- Retries on the normal triggers; when the flag is removed, the queue drains.

The switch exists for a suspected sync bug. It must never delete local data or clear the outbox. `/sync/meta` also returns `{enabled: false}` so the client can distinguish a kill switch from a network failure.

## Server retention

- Daily job prunes `change_log` rows older than 180 days per user.
- After pruning, `sync_state.min_seq` and `head_seq` are recomputed for that user from the remaining rows.
- `sync_ops` rows older than 180 days are pruned too.
- Local `conflicts` rows older than 90 days are pruned on the client.
- Tombstones remain in the entity tables; only the change stream is pruned.
- A snapshot includes live rows only; deleted rows older than the cursor do not need to be sent.

## Security and limits

- Every sync route requires a session.
- A user can only read or write their own rows; the query always includes `user_id`.
- Ops cannot change `user_id`.
- A client cannot push `source='off'` or `source='bls'` foods.
- Per-op payload limit 256 KB; batch 1 MB; batch count 100.
- Rate limit 120 sync requests/minute per session.
- `op_id` reuse across users is impossible; the table is global but scoped on apply.

## Tests

Server:

1. Push a new entry; pull returns it with a higher seq.
2. Push the same batch twice; one row, second result `duplicate`.
3. Push an update with an older `base_seq`; applied with `conflict: true`.
4. Delete, then push an update; `tombstoned`, row remains deleted.
5. Delete twice; second is a no-op.
6. A batch with one invalid op applies the valid ops and rejects only the invalid one.
7. Pull paging with `limit` and `has_more`.
8. `since` below the user's `min_seq` returns `409 resync_required`.
9. Snapshot returns live rows and a cursor that continues correctly.
10. `PLATE_SYNC_ENABLED=false` returns `503 sync_disabled`; the client keeps entries and retries after re-enable.
11. A user cannot read another user's changes (future-proofing test with a second user fixture).
11. Settings and saved meals round-trip with nested items.
12. A user food correction syncs; an OFF food is rejected.

Client:

1. Offline create survives a reload.
2. Two tabs do not double-apply.
3. A crash mid-push returns `inflight` to `pending` on restart.
4. A rejected op does not block later ops.
5. Pull applies in order and advances the cursor atomically.
6. A resync rebuilds from a snapshot and preserves pending user ops.
7. Conflict rows appear in Settings.
8. Undo before and after sync behave as specified.

Two-client convergence:

- Simulate two clients with separate Dexie-like stores and a shared fake server.
- Random sequence of creates, edits, deletes, and syncs; assert both converge to the same live set.
- Run 1,000 randomized operations in CI.

## Deliverables

- [x] change-log and sync-op support in the data layer.
- [x] Push, pull, snapshot, and meta endpoints.
- [x] Client sync engine with outbox, cursor, backoff, leadership, and status store.
- [x] Conflict recording and Settings surface hooks.
- [x] Retention job and per-user `min_seq` in `sync_state`.
- [x] Server and client test suites, including the randomized convergence test.
- [x] Sync status contract for the UI: state, pending count, last synced, conflicts.

## Acceptance

- Two devices converge after arbitrary online/offline sequences.
- No duplicate entries after replayed pushes.
- No lost entry after a crash mid-sync or an offline reload.
- A rejected op is visible and does not block the queue.
- Sync of 100 ops completes in under 300 ms p95 locally.
- The app remains fully usable with sync permanently failing; it shows pending state and keeps logging.

## Out of scope

Multi-user sharing, field-level merge, CRDTs, background sync on iOS, and real-time push (WebSocket/SSE). Polling and foreground triggers are enough.

## Note

Verified: `make verify`; 28 Go tests for the protocol (every server test in the list above, plus rollback of rejected ops, per-user retention, cross-user isolation, kill switch over HTTP, 100-op push p95 under 300 ms, and a seeded 1,000-operation two-client convergence run that also replays batches); 31 Vitest tests for the client engine against an in-memory fake server that follows the Go server's rules (offline create surviving a reload, replay after a lost response, crash recovery of inflight ops, rejected op not blocking, atomic page application, local edit winning over a pulled row, tombstones, conflicts, backoff schedule and jitter, 401, kill switch, Cloudflare HTML answer, two tabs never double-pushing with and without Web Locks, resync that keeps unsent ops, undo before and after sync) and a seeded 1,000-operation two-database convergence run.

Decisions made while building:

- `GET /sync/pull?since=N` returns changes with `seq` greater than N, and `next` is the last seq in the page (or `since` when empty). The plan's example showed `next` one past the last change; an exclusive cursor needs no off-by-one and matches "skip changes at or below the cursor".
- A favorite uses `upsert` to add and `delete` to remove, keyed by food id. A removed favorite may be added again; entries, foods and saved meals may not come back from a tombstone.
- Pull data for a delete is `{deleted_at}` only; an upsert carries the full row.
- A rejected or tombstoned op is not recorded in `sync_ops`, so a corrected op may be resent under the same id. Only applied ops are recorded.
- `min_seq` is the highest pruned `seq` for that user. A client whose cursor equals `min_seq` has everything and needs no snapshot.
- On the client, a pulled upsert is skipped while a pending local upsert exists for the same row (the local edit is pushed next and wins by server receive order); a pulled delete always applies.
- A resync keeps rows that have unsent ops, replaces the rest from the snapshot, saves a rescue copy (last 3 kept in `meta`), and re-queues pending ops under new op ids.
- The engine checks `/sync/meta` first each cycle: a reachable meta means online, `enabled:false` means the kill switch, and a cursor below `min_seq` triggers the snapshot before any push.
- Per-user rate limits: 120 requests a minute for `/sync/*`, tracked separately from the 60 a minute for the rest of the API.

Not verified: the client engine against the real Go server end to end (the fake server mirrors its rules and both sides have convergence tests; the Playwright flow in Phase 8 exercises the real pair); Background Sync (out of scope); real iOS behaviour when a tab is suspended mid-push (replay safety is tested, the timing is not).
