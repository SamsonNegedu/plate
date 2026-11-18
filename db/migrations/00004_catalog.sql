-- +goose Up
-- Reference data from the OFF German seed. Not user-scoped, never synced, replaced wholesale on import.
CREATE TABLE catalog_foods (
    rowid_alias       INTEGER PRIMARY KEY,
    barcode           TEXT NOT NULL UNIQUE CHECK (barcode GLOB '[0-9]*' AND length(barcode) BETWEEN 8 AND 14),
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
    image_source_url  TEXT,
    scans             INTEGER NOT NULL DEFAULT 0,
    source            TEXT NOT NULL DEFAULT 'off_seed',
    dataset_version   TEXT NOT NULL,
    imported_at       TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE VIRTUAL TABLE catalog_fts USING fts5(
    name, brand, barcode,
    content='catalog_foods', content_rowid='rowid_alias',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3'
);

-- +goose StatementBegin
CREATE TRIGGER catalog_ai AFTER INSERT ON catalog_foods BEGIN
    INSERT INTO catalog_fts(rowid, name, brand, barcode)
    VALUES (new.rowid_alias, new.name, new.brand, new.barcode);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER catalog_ad AFTER DELETE ON catalog_foods BEGIN
    INSERT INTO catalog_fts(catalog_fts, rowid, name, brand, barcode)
    VALUES ('delete', old.rowid_alias, old.name, old.brand, old.barcode);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER catalog_au AFTER UPDATE ON catalog_foods BEGIN
    INSERT INTO catalog_fts(catalog_fts, rowid, name, brand, barcode)
    VALUES ('delete', old.rowid_alias, old.name, old.brand, old.barcode);
    INSERT INTO catalog_fts(rowid, name, brand, barcode)
    VALUES (new.rowid_alias, new.name, new.brand, new.barcode);
END;
-- +goose StatementEnd

CREATE TABLE catalog_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

-- +goose Down
DROP TABLE catalog_meta;
DROP TRIGGER catalog_au;
DROP TRIGGER catalog_ad;
DROP TRIGGER catalog_ai;
DROP TABLE catalog_fts;
DROP TABLE catalog_foods;
