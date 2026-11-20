-- +goose Up
-- Body measurements, how someone feels, and medication doses share one table: they are all dated numbers the person logs.
CREATE TABLE health_records (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('weight', 'waist', 'appetite', 'nausea', 'dose')),
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
        (kind = 'waist' AND value BETWEEN 20 AND 300) OR
        (kind IN ('appetite', 'nausea') AND value BETWEEN 0 AND 5) OR
        (kind = 'dose' AND value > 0 AND value <= 100 AND length(trim(medication)) > 0)
    )
) WITHOUT ROWID;
CREATE INDEX health_records_day ON health_records(user_id, kind, recorded_on);
CREATE INDEX health_records_seq ON health_records(user_id, server_seq);

-- The medication plan and the weight goal live with the other goals. All of it is optional.
ALTER TABLE settings ADD COLUMN weight_goal_kg REAL CHECK (weight_goal_kg IS NULL OR weight_goal_kg BETWEEN 20 AND 500);
ALTER TABLE settings ADD COLUMN med_name TEXT CHECK (med_name IS NULL OR length(trim(med_name)) > 0);
ALTER TABLE settings ADD COLUMN med_interval_days INTEGER CHECK (med_interval_days IS NULL OR med_interval_days BETWEEN 1 AND 90);
ALTER TABLE settings ADD COLUMN med_started_on TEXT CHECK (med_started_on IS NULL OR med_started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE settings ADD COLUMN med_supply_doses INTEGER CHECK (med_supply_doses IS NULL OR med_supply_doses BETWEEN 0 AND 1000);
ALTER TABLE settings ADD COLUMN med_supply_as_of TEXT;

-- SQLite cannot change a CHECK, so the change log is rebuilt to accept the new entity. The sequence counter is carried over.
DROP INDEX change_log_user_seq;
ALTER TABLE change_log RENAME TO change_log_old;
CREATE TABLE change_log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity     TEXT NOT NULL CHECK (entity IN ('settings', 'food', 'entry', 'saved_meal', 'favorite', 'health_record')),
    entity_id  TEXT NOT NULL,
    op         TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    payload    TEXT NOT NULL CHECK (json_valid(payload)),
    created_at TEXT NOT NULL
);
INSERT INTO change_log (seq, user_id, entity, entity_id, op, payload, created_at)
    SELECT seq, user_id, entity, entity_id, op, payload, created_at FROM change_log_old;
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'change_log', seq FROM sqlite_sequence
    WHERE name = 'change_log_old' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'change_log');
UPDATE sqlite_sequence
    SET seq = max(seq, coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'change_log_old'), 0))
    WHERE name = 'change_log';
DROP TABLE change_log_old;
CREATE INDEX change_log_user_seq ON change_log(user_id, seq);

-- +goose Down
DROP INDEX health_records_seq;
DROP INDEX health_records_day;
DROP TABLE health_records;
ALTER TABLE settings DROP COLUMN med_supply_as_of;
ALTER TABLE settings DROP COLUMN med_supply_doses;
ALTER TABLE settings DROP COLUMN med_started_on;
ALTER TABLE settings DROP COLUMN med_interval_days;
ALTER TABLE settings DROP COLUMN med_name;
ALTER TABLE settings DROP COLUMN weight_goal_kg;
