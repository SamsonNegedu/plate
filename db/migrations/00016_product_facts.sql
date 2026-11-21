-- +goose Up
-- Community-corrected product facts (ADR-020). Reference data about a barcode, shared by every account. Never synced as
-- client writes and never touched by a catalog reimport. Nutrient names follow Open Food Facts so a row can be pushed
-- upstream later.
CREATE TABLE product_fact_revisions (
    id               TEXT PRIMARY KEY,
    barcode          TEXT NOT NULL CHECK (barcode GLOB '[0-9]*'),
    contributor      TEXT NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('manual', 'ocr')),
    origin           TEXT NOT NULL CHECK (origin IN ('off_correction', 'off_missing_fields', 'new_product')),
    status           TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'superseded', 'reverted')),
    app_version      TEXT NOT NULL DEFAULT '',
    lang             TEXT NOT NULL DEFAULT 'de',
    countries        TEXT NOT NULL DEFAULT 'en:germany',
    product_name     TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
    brands           TEXT NOT NULL DEFAULT '',
    quantity         TEXT NOT NULL DEFAULT '',
    serving_size     TEXT NOT NULL DEFAULT '',
    serving_grams    REAL CHECK (serving_grams IS NULL OR serving_grams > 0),
    ingredients_text TEXT NOT NULL DEFAULT '',
    energy_kcal_100g REAL NOT NULL CHECK (energy_kcal_100g >= 0),
    energy_kj_100g   REAL CHECK (energy_kj_100g IS NULL OR energy_kj_100g >= 0),
    fat_100g         REAL CHECK (fat_100g IS NULL OR fat_100g >= 0),
    saturated_fat_100g REAL CHECK (saturated_fat_100g IS NULL OR saturated_fat_100g >= 0),
    carbohydrates_100g REAL CHECK (carbohydrates_100g IS NULL OR carbohydrates_100g >= 0),
    sugars_100g      REAL CHECK (sugars_100g IS NULL OR sugars_100g >= 0),
    fiber_100g       REAL CHECK (fiber_100g IS NULL OR fiber_100g >= 0),
    proteins_100g    REAL CHECK (proteins_100g IS NULL OR proteins_100g >= 0),
    salt_100g        REAL CHECK (salt_100g IS NULL OR salt_100g >= 0),
    label_image      BLOB,
    front_image      BLOB,
    submitted_at     TEXT NOT NULL,
    accepted_at      TEXT,
    pushed_at        TEXT
);
CREATE INDEX product_fact_revisions_barcode ON product_fact_revisions(barcode, submitted_at);
CREATE INDEX product_fact_revisions_status ON product_fact_revisions(status);

CREATE TABLE product_facts (
    barcode           TEXT PRIMARY KEY CHECK (barcode GLOB '[0-9]*'),
    revision_id       TEXT NOT NULL REFERENCES product_fact_revisions(id),
    status            TEXT NOT NULL CHECK (status IN ('accepted', 'upstream_confirmed')),
    updated_at        TEXT NOT NULL
);

CREATE TABLE product_fact_disputes (
    barcode     TEXT NOT NULL,
    revision_id TEXT NOT NULL REFERENCES product_fact_revisions(id),
    contributor TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (revision_id, contributor)
);

-- Set on a user's server-managed food row when its nutrition came from an accepted community fact.
ALTER TABLE foods ADD COLUMN community_rev TEXT;

-- +goose Down
ALTER TABLE foods DROP COLUMN community_rev;
DROP TABLE product_fact_disputes;
DROP TABLE product_facts;
DROP TABLE product_fact_revisions;
