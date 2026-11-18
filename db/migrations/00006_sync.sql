-- +goose Up
-- seq is global; a user's own stream is monotonic and, with one user, gap-free. server_seq on rows is a change_log seq.
CREATE TABLE change_log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity     TEXT NOT NULL CHECK (entity IN ('settings', 'food', 'entry', 'saved_meal', 'favorite')),
    entity_id  TEXT NOT NULL,
    op         TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    payload    TEXT NOT NULL CHECK (json_valid(payload)),
    created_at TEXT NOT NULL
);
CREATE INDEX change_log_user_seq ON change_log(user_id, seq);

CREATE TABLE sync_state (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    min_seq    INTEGER NOT NULL DEFAULT 0,
    head_seq   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE sync_ops (
    op_id      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  TEXT NOT NULL,
    result     TEXT NOT NULL CHECK (json_valid(result)),
    applied_at TEXT NOT NULL,
    server_seq INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX sync_ops_applied ON sync_ops(user_id, applied_at);

CREATE TABLE search_cache (
    key        TEXT PRIMARY KEY,
    response   TEXT NOT NULL,
    expires_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX search_cache_expires ON search_cache(expires_at);

CREATE TABLE image_cache (
    key           TEXT PRIMARY KEY,
    content_type  TEXT NOT NULL,
    bytes         INTEGER NOT NULL CHECK (bytes >= 0),
    fetched_at    TEXT NOT NULL,
    last_used_at  TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX image_cache_used ON image_cache(last_used_at);

INSERT INTO meta(key, value) VALUES ('schema_version', '6')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- +goose Down
DELETE FROM meta WHERE key = 'schema_version';
DROP INDEX image_cache_used;
DROP TABLE image_cache;
DROP INDEX search_cache_expires;
DROP TABLE search_cache;
DROP INDEX sync_ops_applied;
DROP TABLE sync_ops;
DROP TABLE sync_state;
DROP INDEX change_log_user_seq;
DROP TABLE change_log;
