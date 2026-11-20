-- +goose Up
-- A fibre target beside the macro targets. Like them, 0 means "not tracked".
ALTER TABLE settings ADD COLUMN fiber_g INTEGER NOT NULL DEFAULT 0 CHECK (fiber_g BETWEEN 0 AND 200);

-- +goose Down
ALTER TABLE settings DROP COLUMN fiber_g;
