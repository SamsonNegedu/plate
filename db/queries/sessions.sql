-- name: GetSession :one
SELECT token_hash, user_id, data, expiry FROM sessions WHERE token_hash = ?;

-- name: UpsertSession :exec
INSERT INTO sessions (token_hash, user_id, data, expiry) VALUES (?, ?, ?, ?)
ON CONFLICT (token_hash) DO UPDATE SET data = excluded.data, expiry = excluded.expiry;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = ?;

-- name: DeleteSessionsByUser :execrows
DELETE FROM sessions WHERE user_id = ?;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expiry < ?;

-- name: CountSessionsByUser :one
SELECT count(*) FROM sessions WHERE user_id = ?;
