-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = ?;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = ?;

-- name: InsertUser :exec
INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?);

-- name: UpdateUserPassword :execrows
UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?;

-- name: TouchLastLogin :exec
UPDATE users SET last_login_at = ? WHERE id = ?;

-- name: DeleteUser :execrows
DELETE FROM users WHERE id = ?;

-- name: InsertRecoveryCode :exec
INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?);

-- name: DeleteRecoveryCodes :exec
DELETE FROM recovery_codes WHERE user_id = ?;

-- name: ListUnusedRecoveryHashes :many
SELECT code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL;

-- name: UseRecoveryCode :execrows
UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL;

-- name: CountUnusedRecoveryCodes :one
SELECT count(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL;

-- name: GetCodesAcknowledged :one
SELECT codes_acknowledged_at FROM users WHERE id = ?;

-- name: SetCodesAcknowledged :exec
UPDATE users SET codes_acknowledged_at = ? WHERE id = ?;
