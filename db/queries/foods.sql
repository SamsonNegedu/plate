-- name: GetFood :one
SELECT * FROM foods WHERE id = ? AND user_id = ?;

-- name: GetLiveFoodByBarcode :one
SELECT * FROM foods WHERE user_id = ? AND barcode = ? AND deleted_at IS NULL;

-- name: UpsertFood :execrows
INSERT INTO foods (
    id, user_id, barcode, name, brand, quantity, serving_size, serving_grams, kcal_100g,
    protein_100g, carbs_100g, fat_100g, sugar_100g, satfat_100g, fiber_100g, salt_100g,
    nutriscore, source, source_id, source_updated_at, source_checked_at, image_key,
    ingredients, allergens, search_name, created_at, updated_at, deleted_at, server_seq, community_rev, category
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
    barcode = excluded.barcode, name = excluded.name, brand = excluded.brand,
    quantity = excluded.quantity, serving_size = excluded.serving_size, serving_grams = excluded.serving_grams,
    kcal_100g = excluded.kcal_100g, protein_100g = excluded.protein_100g, carbs_100g = excluded.carbs_100g,
    fat_100g = excluded.fat_100g, sugar_100g = excluded.sugar_100g, satfat_100g = excluded.satfat_100g,
    fiber_100g = excluded.fiber_100g, salt_100g = excluded.salt_100g, nutriscore = excluded.nutriscore,
    source = excluded.source, source_id = excluded.source_id, source_updated_at = excluded.source_updated_at,
    source_checked_at = excluded.source_checked_at, image_key = excluded.image_key,
    ingredients = excluded.ingredients, allergens = excluded.allergens, search_name = excluded.search_name,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, server_seq = excluded.server_seq,
    community_rev = excluded.community_rev, category = excluded.category
WHERE foods.user_id = excluded.user_id;

-- name: SearchFoods :many
SELECT f.*
FROM foods_fts
JOIN foods f ON f.rowid = foods_fts.rowid
WHERE foods_fts MATCH sqlc.arg(match) AND f.user_id = sqlc.arg(user_id) AND f.deleted_at IS NULL
ORDER BY bm25(foods_fts, 10.0, 5.0, 50.0)
LIMIT sqlc.arg(max_rows);

-- name: FoodExists :one
SELECT count(*) FROM foods WHERE id = ? AND user_id = ?;

-- name: ListUserFoods :many
SELECT * FROM foods WHERE user_id = ? AND source = 'user' ORDER BY id;

-- name: ListFoodsByIDs :many
SELECT * FROM foods WHERE user_id = sqlc.arg(user_id) AND id IN (sqlc.slice(ids)) ORDER BY id;

-- name: GetFoodBySource :one
SELECT * FROM foods WHERE user_id = ? AND source = ? AND source_id = ? LIMIT 1;

-- name: ListRecentFoods :many
SELECT f.*
FROM foods f
JOIN (
    SELECT e.food_id AS food_id, max(e.created_at) AS last_at
    FROM entries e
    WHERE e.user_id = sqlc.arg(user_id) AND e.food_id IS NOT NULL AND e.deleted_at IS NULL
    GROUP BY e.food_id
    ORDER BY last_at DESC
    LIMIT sqlc.arg(max_rows)
) r ON r.food_id = f.id
WHERE f.deleted_at IS NULL
ORDER BY r.last_at DESC;

-- name: ListFavoriteFoodIDs :many
SELECT food_id FROM favorites WHERE user_id = ? AND deleted_at IS NULL;

-- name: CountFoodUsesSince :one
SELECT count(*) FROM entries WHERE user_id = ? AND food_id = ? AND deleted_at IS NULL AND created_at >= ?;

-- name: ListFoodsByBarcodes :many
SELECT * FROM foods WHERE user_id = sqlc.arg(user_id) AND deleted_at IS NULL AND barcode IN (sqlc.slice(barcodes));

-- name: SearchFoodsInfix :many
SELECT f.*
FROM foods_trgm
JOIN foods f ON f.rowid = foods_trgm.rowid
WHERE foods_trgm MATCH sqlc.arg(match) AND f.user_id = sqlc.arg(user_id) AND f.deleted_at IS NULL
ORDER BY bm25(foods_trgm, 10.0, 5.0)
LIMIT sqlc.arg(max_rows);

-- name: CountLiveUserFoods :one
SELECT count(*) FROM foods WHERE user_id = ? AND source = 'user' AND deleted_at IS NULL;
