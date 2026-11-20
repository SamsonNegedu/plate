-- +goose Up
-- A saved meal is now a recipe: its ingredients plus how many portions it makes. Existing rows become one-portion recipes.
ALTER TABLE saved_meals ADD COLUMN servings REAL NOT NULL DEFAULT 1 CHECK (servings > 0 AND servings <= 1000);

-- +goose Down
ALTER TABLE saved_meals DROP COLUMN servings;
