-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: GetFirstUser :one
SELECT id, email, password_hash, created_at, updated_at, last_login_at FROM users ORDER BY created_at LIMIT 1;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, created_at, updated_at, last_login_at FROM users WHERE email = ?;

-- name: GetUserByID :one
SELECT id, email, password_hash, created_at, updated_at, last_login_at FROM users WHERE id = ?;

-- name: InsertUser :exec
INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?);

-- name: UpdateUserPassword :execrows
UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?;

-- name: TouchLastLogin :exec
UPDATE users SET last_login_at = ? WHERE id = ?;
