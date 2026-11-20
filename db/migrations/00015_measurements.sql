-- +goose Up
-- More body measurements beside weight and waist. SQLite cannot change a CHECK, so the table is rebuilt.
DROP INDEX health_records_seq;
DROP INDEX health_records_day;
ALTER TABLE health_records RENAME TO health_records_old;
CREATE TABLE health_records (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('weight', 'waist', 'hips', 'chest', 'arm', 'thigh', 'neck', 'appetite', 'nausea', 'dose')),
    recorded_on TEXT NOT NULL CHECK (recorded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    recorded_at TEXT NOT NULL,
    value       REAL NOT NULL,
    medication  TEXT NOT NULL DEFAULT '',
    site        TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    server_seq  INTEGER NOT NULL DEFAULT 0,
    CHECK (
        (kind = 'weight' AND value BETWEEN 20 AND 500) OR
        (kind IN ('waist', 'hips', 'chest', 'arm', 'thigh', 'neck') AND value BETWEEN 10 AND 300) OR
        (kind IN ('appetite', 'nausea') AND value BETWEEN 0 AND 5) OR
        (kind = 'dose' AND value > 0 AND value <= 100 AND length(trim(medication)) > 0)
    )
) WITHOUT ROWID;
INSERT INTO health_records
    SELECT id, user_id, kind, recorded_on, recorded_at, value, medication, site, note, created_at, updated_at, deleted_at, server_seq
    FROM health_records_old;
DROP TABLE health_records_old;
CREATE INDEX health_records_day ON health_records(user_id, kind, recorded_on);
CREATE INDEX health_records_seq ON health_records(user_id, server_seq);

-- +goose Down
-- The wider CHECK stays: narrowing it again would have to delete the measurements that no longer fit.
SELECT 1;
