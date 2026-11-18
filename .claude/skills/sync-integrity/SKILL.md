---
name: sync-integrity
description: Use whenever a change touches entries, foods, settings, saved meals, favorites, the outbox, change log, sync endpoints, migrations of syncable tables, or undo/delete behavior. Protects against data loss, duplicates, and resurrection.
---

# Sync and data integrity guardrails

## Hard invariants

1. Client-generated UUIDv7 for entries and user foods. The ID is created before the first network call.
2. Every mutation has an `op_id`. Replaying it is safe.
3. `server_seq` is assigned only from the per-user change log, in the same transaction as the row change.
4. Deletes are tombstones. No hard delete of a syncable row.
5. A tombstoned row is not resurrected by an older upsert. Return `tombstoned`.
6. Pull applies changes in `seq` order and advances the cursor in the same Dexie transaction.
7. A cursor below the user's `min_seq` forces a snapshot. Never apply a partial history. `change_log.seq` is global; `sync_state.min_seq` and `head_seq` are per user, so one user's pruning never forces another's resync.
8. The outbox is the only non-re-fetchable local store. It survives schema upgrades and crashes.
9. An `inflight` op returns to `pending` on startup.
10. Nutrition snapshots on entries are immutable. A food edit never rewrites an existing entry.
11. Day totals derive from local entries, never from a server-cached total.
12. One tab drains the outbox. Duplicate pushes are safe, but avoid them.

## Protocol rules

- Push batch max 100 ops, body max 1 MB.
- Validate the whole batch, then apply each op under a savepoint. One invalid op does not roll back the rest.
- Check `sync_ops.op_id` before applying. Return the stored result on a duplicate.
- `base_seq` is advisory for conflict reporting; it does not block the write.
- Entity-level LWW by server receive order. Record a local conflict when the server overwrites a newer local row.
- Settings and saved meals replace the full object; saved-meal items are nested.
- Only `source='user'` foods sync. OFF/BLS/catalog rows are server-managed.
- A user cannot push a row with another `user_id`.
- Undo of a delete before sync cancels the op and undeletes locally. After sync, create a new entry with a new ID.

## Client outbox

- Write the optimistic row and the outbox op in one Dexie transaction.
- States: `pending`, `inflight`, `failed`. Failed ops are visible and retryable; they never block the queue.
- Drain order is `createdAt` then `id`.
- Backoff: 1, 2, 4, 8, 16, 30, 60 s with jitter; persist `nextAttemptAt`.
- 401 pauses sync and asks for login. It never clears the outbox.
- 409 `resync_required` triggers rescue export, snapshot, and pending-op replay.
- `503 sync_disabled` (`PLATE_SYNC_ENABLED=false`) pauses the queue but never deletes it. The client keeps logging and retries after re-enable.
- A successful push removes applied and duplicate ops; rejected ops stay for review.
- Pull pages are applied atomically; a failure leaves the cursor unchanged.

## Migrations

- Adding a syncable table requires: `user_id`, timestamps, `deleted_at`, `server_seq`, indexes for pull order.
- Adding a field is additive and nullable, or has a safe default.
- Renaming or removing a field in a syncable table requires expand/contract across releases.
- A backfill never runs inside the migration transaction on a large table; use a bounded job with progress.
- Every migration that changes sync shape updates the randomized convergence test.

## Required tests

- Duplicate op does not duplicate a row.
- Update after delete returns `tombstoned`.
- Invalid op in a batch does not block the valid ops.
- Pull paging and cursor atomicity.
- Snapshot + continue pull.
- `min_seq` gap forces a snapshot and preserves pending ops.
- Two tabs do not double-drain.
- Crash mid-push recovers `inflight`.
- Randomized two-client convergence with creates, edits, deletes, and offline gaps.
- Export/import restores the exact live set.
- A food correction does not rewrite historical entries.

## Review checklist

- [ ] No hard delete introduced.
- [ ] Every new mutation has an `op_id` and an outbox path.
- [ ] `server_seq` assigned in the same transaction.
- [ ] No network call inside the transaction.
- [ ] Tombstone behavior tested.
- [ ] Historical snapshots untouched.
- [ ] Migration additive or expand/contract.
- [ ] Randomized convergence test still passes.
- [ ] UI shows pending, offline, and error states truthfully.

## Anti-patterns

- `POST /entries` with a server-generated ID.
- "Last sync wins" implemented by comparing device clocks.
- Deleting change-log rows without recomputing that user's `sync_state.min_seq`.
- Clearing the outbox on a 401 or a `sync_disabled` response.
- Deleting change-log rows without advancing `min_seq`.
- Updating a food and expecting old entries to change.
- Syncing OFF cache rows from the client.
- A second cache layer for API rows in the service worker.
