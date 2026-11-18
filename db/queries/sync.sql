-- name: AppendChange :one
INSERT INTO change_log (user_id, entity, entity_id, op, payload, created_at)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING seq;

-- name: ListChangesSince :many
SELECT seq, user_id, entity, entity_id, op, payload, created_at
FROM change_log WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?;

-- name: GetSyncState :one
SELECT user_id, min_seq, head_seq, updated_at FROM sync_state WHERE user_id = ?;

-- name: UpsertSyncState :exec
INSERT INTO sync_state (user_id, min_seq, head_seq, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET min_seq = excluded.min_seq, head_seq = excluded.head_seq, updated_at = excluded.updated_at;

-- name: GetSyncOp :one
SELECT op_id, user_id, client_id, result, applied_at, server_seq FROM sync_ops WHERE op_id = ? AND user_id = ?;

-- name: InsertSyncOp :exec
INSERT INTO sync_ops (op_id, user_id, client_id, result, applied_at, server_seq) VALUES (?, ?, ?, ?, ?, ?);

-- name: PruneChangeLog :execrows
DELETE FROM change_log WHERE user_id = ? AND created_at < ?;

-- name: MinChangeSeq :one
SELECT CAST(coalesce(min(seq), 0) AS INTEGER) FROM change_log WHERE user_id = ?;

-- name: MaxChangeSeq :one
SELECT CAST(coalesce(max(seq), 0) AS INTEGER) FROM change_log WHERE user_id = ?;

-- name: PruneSyncOps :execrows
DELETE FROM sync_ops WHERE applied_at < ?;

-- name: SetChangePayload :exec
UPDATE change_log SET payload = ? WHERE seq = ? AND user_id = ?;

-- name: MaxChangeSeqBefore :one
SELECT CAST(coalesce(max(seq), 0) AS INTEGER) FROM change_log WHERE user_id = ? AND created_at < ?;

-- name: ListUserIDs :many
SELECT id FROM users ORDER BY id;
