-- +goose Up
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
) WITHOUT ROWID;

-- token_hash is the SHA-256 of the cookie token; the token itself is never stored.
CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data       BLOB NOT NULL,
    expiry     TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX sessions_user_expiry ON sessions(user_id, expiry);

CREATE TABLE settings (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    goal_kcal      INTEGER NOT NULL CHECK (goal_kcal > 0),
    protein_g      INTEGER NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g        INTEGER NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g          INTEGER NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    day_start_hour INTEGER NOT NULL DEFAULT 0 CHECK (day_start_hour BETWEEN 0 AND 23),
    theme          TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto', 'light', 'dark')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    server_seq     INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- +goose Down
DROP TABLE settings;
DROP INDEX sessions_user_expiry;
DROP TABLE sessions;
DROP TABLE users;
