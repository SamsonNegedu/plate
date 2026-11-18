-- name: UpsertSavedMeal :execrows
INSERT INTO saved_meals (id, user_id, name, created_at, updated_at, deleted_at, server_seq)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
    name = excluded.name, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, server_seq = excluded.server_seq
WHERE saved_meals.user_id = excluded.user_id;

-- name: GetSavedMeal :one
SELECT * FROM saved_meals WHERE id = ? AND user_id = ?;

-- name: ListAllSavedMeals :many
SELECT * FROM saved_meals WHERE user_id = ? ORDER BY created_at, id;

-- name: DeleteSavedMealItems :exec
DELETE FROM saved_meal_items WHERE saved_meal_id = ?;

-- name: InsertSavedMealItem :exec
INSERT INTO saved_meal_items (
    id, saved_meal_id, food_id, name, brand, amount, unit, grams, kcal_100g,
    protein_100g, carbs_100g, fat_100g, sugar_100g, satfat_100g, fiber_100g, salt_100g, position
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: ListSavedMealItems :many
SELECT * FROM saved_meal_items WHERE saved_meal_id = ? ORDER BY position, id;

-- name: UpsertFavorite :exec
INSERT INTO favorites (user_id, food_id, created_at, updated_at, deleted_at, server_seq)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, food_id) DO UPDATE SET
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, server_seq = excluded.server_seq;

-- name: GetFavorite :one
SELECT * FROM favorites WHERE user_id = ? AND food_id = ?;

-- name: ListAllFavorites :many
SELECT * FROM favorites WHERE user_id = ? ORDER BY food_id;
