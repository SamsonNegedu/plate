-- +goose Up
-- The server records which allowlisted URL a key stands for, so a client never supplies or sees a URL.
ALTER TABLE image_cache ADD COLUMN source_url TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE image_cache DROP COLUMN source_url;
