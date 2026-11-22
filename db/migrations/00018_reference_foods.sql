-- +goose Up
-- Generic foods without a barcode (West African staples, soup ingredients), as shared reference data.
-- Same shape as catalog_foods, keyed by a text id instead of a barcode. Not user-scoped, never synced,
-- replaced wholesale on import. A row becomes a foods row only when someone selects it.
CREATE TABLE reference_foods (
    rowid_alias     INTEGER PRIMARY KEY,
    ref_id          TEXT NOT NULL UNIQUE CHECK (length(trim(ref_id)) > 0),
    name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
    local_names     TEXT NOT NULL DEFAULT '',
    scientific_name TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT '',
    kcal_100g       REAL NOT NULL CHECK (kcal_100g >= 0),
    protein_100g    REAL CHECK (protein_100g IS NULL OR protein_100g >= 0),
    carbs_100g      REAL CHECK (carbs_100g IS NULL OR carbs_100g >= 0),
    fat_100g        REAL CHECK (fat_100g IS NULL OR fat_100g >= 0),
    sugar_100g      REAL CHECK (sugar_100g IS NULL OR sugar_100g >= 0),
    satfat_100g     REAL CHECK (satfat_100g IS NULL OR satfat_100g >= 0),
    fiber_100g      REAL CHECK (fiber_100g IS NULL OR fiber_100g >= 0),
    salt_100g       REAL CHECK (salt_100g IS NULL OR salt_100g >= 0),
    estimated       INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
    source          TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    imported_at     TEXT NOT NULL
);

CREATE VIRTUAL TABLE reference_fts USING fts5(
    name, local_names, scientific_name,
    content='reference_foods', content_rowid='rowid_alias',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3'
);

-- +goose StatementBegin
CREATE TRIGGER reference_ai AFTER INSERT ON reference_foods BEGIN
    INSERT INTO reference_fts(rowid, name, local_names, scientific_name)
    VALUES (new.rowid_alias, new.name, new.local_names, new.scientific_name);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER reference_ad AFTER DELETE ON reference_foods BEGIN
    INSERT INTO reference_fts(reference_fts, rowid, name, local_names, scientific_name)
    VALUES ('delete', old.rowid_alias, old.name, old.local_names, old.scientific_name);
END;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER reference_ad;
DROP TRIGGER reference_ai;
DROP TABLE reference_fts;
DROP TABLE reference_foods;
