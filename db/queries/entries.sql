-- name: GetEntry :one
SELECT * FROM entries WHERE id = ? AND user_id = ?;

-- name: UpsertEntry :execrows
INSERT INTO entries (
    id, user_id, eaten_on, meal, food_id, name, brand, barcode, amount, unit, grams, kcal_100g,
    protein_100g, carbs_100g, fat_100g, sugar_100g, satfat_100g, fiber_100g, salt_100g,
    note, created_at, updated_at, client_updated_at, deleted_at, server_seq
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
    eaten_on = excluded.eaten_on, meal = excluded.meal, food_id = excluded.food_id,
    name = excluded.name, brand = excluded.brand, barcode = excluded.barcode,
    amount = excluded.amount, unit = excluded.unit, grams = excluded.grams, kcal_100g = excluded.kcal_100g,
    protein_100g = excluded.protein_100g, carbs_100g = excluded.carbs_100g, fat_100g = excluded.fat_100g,
    sugar_100g = excluded.sugar_100g, satfat_100g = excluded.satfat_100g, fiber_100g = excluded.fiber_100g,
    salt_100g = excluded.salt_100g, note = excluded.note, updated_at = excluded.updated_at,
    client_updated_at = excluded.client_updated_at, deleted_at = excluded.deleted_at, server_seq = excluded.server_seq
WHERE entries.user_id = excluded.user_id;

-- name: ListEntriesForDay :many
SELECT * FROM entries
WHERE user_id = ? AND eaten_on = ? AND deleted_at IS NULL
ORDER BY created_at, id;

-- name: ListEntriesInRange :many
SELECT * FROM entries
WHERE user_id = sqlc.arg(user_id) AND eaten_on >= sqlc.arg(from_day) AND eaten_on <= sqlc.arg(to_day) AND deleted_at IS NULL
ORDER BY eaten_on, created_at, id;

-- name: ListEntriesSince :many
SELECT * FROM entries WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?;

-- name: ListAllEntries :many
SELECT * FROM entries WHERE user_id = ? ORDER BY eaten_on, created_at, id;
