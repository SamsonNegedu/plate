-- +goose Up
CREATE TABLE foods (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    barcode           TEXT CHECK (barcode IS NULL OR barcode GLOB '[0-9]*'),
    name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
    brand             TEXT NOT NULL DEFAULT '',
    quantity          TEXT NOT NULL DEFAULT '',
    serving_size      TEXT NOT NULL DEFAULT '',
    serving_grams     REAL CHECK (serving_grams IS NULL OR serving_grams > 0),
    kcal_100g         REAL NOT NULL CHECK (kcal_100g >= 0),
    protein_100g      REAL CHECK (protein_100g IS NULL OR protein_100g >= 0),
    carbs_100g        REAL CHECK (carbs_100g IS NULL OR carbs_100g >= 0),
    fat_100g          REAL CHECK (fat_100g IS NULL OR fat_100g >= 0),
    sugar_100g        REAL CHECK (sugar_100g IS NULL OR sugar_100g >= 0),
    satfat_100g       REAL CHECK (satfat_100g IS NULL OR satfat_100g >= 0),
    fiber_100g        REAL CHECK (fiber_100g IS NULL OR fiber_100g >= 0),
    salt_100g         REAL CHECK (salt_100g IS NULL OR salt_100g >= 0),
    nutriscore        TEXT CHECK (nutriscore IS NULL OR nutriscore IN ('a', 'b', 'c', 'd', 'e')),
    source            TEXT NOT NULL CHECK (source IN ('off', 'bls', 'user', 'catalog')),
    source_id         TEXT,
    source_updated_at TEXT,
    source_checked_at TEXT,
    image_key         TEXT,
    ingredients       TEXT NOT NULL DEFAULT '',
    allergens         TEXT NOT NULL DEFAULT '',
    search_name       TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT,
    server_seq        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX foods_live_barcode ON foods(user_id, barcode)
    WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX foods_search_name ON foods(user_id, search_name);
CREATE INDEX foods_source ON foods(user_id, source);
CREATE INDEX foods_seq ON foods(user_id, server_seq);
CREATE INDEX foods_updated ON foods(user_id, updated_at);

CREATE VIRTUAL TABLE foods_fts USING fts5(
    name, brand, barcode,
    content='foods', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3'
);

-- +goose StatementBegin
CREATE TRIGGER foods_ai AFTER INSERT ON foods BEGIN
    INSERT INTO foods_fts(rowid, name, brand, barcode)
    VALUES (new.rowid, new.name, new.brand, coalesce(new.barcode, ''));
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER foods_ad AFTER DELETE ON foods BEGIN
    INSERT INTO foods_fts(foods_fts, rowid, name, brand, barcode)
    VALUES ('delete', old.rowid, old.name, old.brand, coalesce(old.barcode, ''));
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER foods_au AFTER UPDATE ON foods BEGIN
    INSERT INTO foods_fts(foods_fts, rowid, name, brand, barcode)
    VALUES ('delete', old.rowid, old.name, old.brand, coalesce(old.barcode, ''));
    INSERT INTO foods_fts(rowid, name, brand, barcode)
    VALUES (new.rowid, new.name, new.brand, coalesce(new.barcode, ''));
END;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER foods_au;
DROP TRIGGER foods_ad;
DROP TRIGGER foods_ai;
DROP TABLE foods_fts;
DROP TABLE foods;
