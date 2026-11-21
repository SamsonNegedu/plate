-- +goose Up
-- How a product's nutrition compares with the rest of its Open Food Facts category (smoked salmons, chocolates, ...).
-- The catalog build computes the ranges from the whole German dump; the app only stores and reads them.
ALTER TABLE catalog_foods ADD COLUMN category TEXT;
ALTER TABLE foods ADD COLUMN category TEXT;

CREATE TABLE category_stats (
    category TEXT PRIMARY KEY,
    n        INTEGER NOT NULL CHECK (n > 0),
    -- JSON: {"kcal":[p05,median,p95],"fat":[...],"protein":[...],"carbs":[...],"salt":[...]} per 100 g
    ranges   TEXT NOT NULL
) WITHOUT ROWID;

-- +goose Down
DROP TABLE category_stats;
ALTER TABLE foods DROP COLUMN category;
ALTER TABLE catalog_foods DROP COLUMN category;
