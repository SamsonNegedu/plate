-- +goose Up
CREATE TABLE entries (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    eaten_on          TEXT NOT NULL CHECK (eaten_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    meal              TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
    food_id           TEXT REFERENCES foods(id) ON DELETE SET NULL,
    name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
    brand             TEXT NOT NULL DEFAULT '',
    barcode           TEXT,
    amount            REAL NOT NULL CHECK (amount > 0),
    unit              TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'piece', 'serving')),
    grams             REAL NOT NULL CHECK (grams > 0),
    kcal_100g         REAL NOT NULL CHECK (kcal_100g >= 0),
    protein_100g      REAL CHECK (protein_100g IS NULL OR protein_100g >= 0),
    carbs_100g        REAL CHECK (carbs_100g IS NULL OR carbs_100g >= 0),
    fat_100g          REAL CHECK (fat_100g IS NULL OR fat_100g >= 0),
    sugar_100g        REAL CHECK (sugar_100g IS NULL OR sugar_100g >= 0),
    satfat_100g       REAL CHECK (satfat_100g IS NULL OR satfat_100g >= 0),
    fiber_100g        REAL CHECK (fiber_100g IS NULL OR fiber_100g >= 0),
    salt_100g         REAL CHECK (salt_100g IS NULL OR salt_100g >= 0),
    note              TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    client_updated_at TEXT NOT NULL,
    deleted_at        TEXT,
    server_seq        INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX entries_day ON entries(user_id, eaten_on);
CREATE INDEX entries_day_meal ON entries(user_id, eaten_on, meal);
CREATE INDEX entries_food ON entries(user_id, food_id);
CREATE INDEX entries_seq ON entries(user_id, server_seq);
CREATE INDEX entries_updated ON entries(user_id, updated_at);

CREATE TABLE saved_meals (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    server_seq INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX saved_meals_seq ON saved_meals(user_id, server_seq);

CREATE TABLE saved_meal_items (
    id            TEXT PRIMARY KEY,
    saved_meal_id TEXT NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
    food_id       TEXT REFERENCES foods(id) ON DELETE SET NULL,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    brand         TEXT NOT NULL DEFAULT '',
    amount        REAL NOT NULL CHECK (amount > 0),
    unit          TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'piece', 'serving')),
    grams         REAL NOT NULL CHECK (grams > 0),
    kcal_100g     REAL NOT NULL CHECK (kcal_100g >= 0),
    protein_100g  REAL CHECK (protein_100g IS NULL OR protein_100g >= 0),
    carbs_100g    REAL CHECK (carbs_100g IS NULL OR carbs_100g >= 0),
    fat_100g      REAL CHECK (fat_100g IS NULL OR fat_100g >= 0),
    sugar_100g    REAL CHECK (sugar_100g IS NULL OR sugar_100g >= 0),
    satfat_100g   REAL CHECK (satfat_100g IS NULL OR satfat_100g >= 0),
    fiber_100g    REAL CHECK (fiber_100g IS NULL OR fiber_100g >= 0),
    salt_100g     REAL CHECK (salt_100g IS NULL OR salt_100g >= 0),
    position      INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX saved_meal_items_meal ON saved_meal_items(saved_meal_id, position);

-- A favorite is a relation. Removing one is a tombstone so the removal syncs.
CREATE TABLE favorites (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_id    TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    server_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, food_id)
) WITHOUT ROWID;
CREATE INDEX favorites_seq ON favorites(user_id, server_seq);

-- +goose Down
DROP INDEX favorites_seq;
DROP TABLE favorites;
DROP INDEX saved_meal_items_meal;
DROP TABLE saved_meal_items;
DROP INDEX saved_meals_seq;
DROP TABLE saved_meals;
DROP TABLE entries;
