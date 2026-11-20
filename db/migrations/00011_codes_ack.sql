-- +goose Up
-- Set when the person confirms they saved their recovery codes; cleared whenever new codes are made.
ALTER TABLE users ADD COLUMN codes_acknowledged_at TEXT;

-- +goose Down
ALTER TABLE users DROP COLUMN codes_acknowledged_at;
