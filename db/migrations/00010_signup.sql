-- +goose Up
-- Sign-in is by username now. The column keeps its values, so an existing email-style sign-in still works.
ALTER TABLE users RENAME COLUMN email TO username;

-- Single-use password-reset codes. Only a SHA-256 of the code is stored; the codes carry 50 bits of randomness and are
-- rate limited, so a fast hash is enough.
CREATE TABLE recovery_codes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  BLOB NOT NULL,
    created_at TEXT NOT NULL,
    used_at    TEXT,
    PRIMARY KEY (user_id, code_hash)
) WITHOUT ROWID;

-- +goose Down
DROP TABLE recovery_codes;
ALTER TABLE users RENAME COLUMN username TO email;
