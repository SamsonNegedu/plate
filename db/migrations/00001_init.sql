-- +goose Up
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

-- +goose Down
DROP TABLE meta;
