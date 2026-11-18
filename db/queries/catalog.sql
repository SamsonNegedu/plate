-- name: GetCatalogFoodByBarcode :one
SELECT * FROM catalog_foods WHERE barcode = ?;

-- name: InsertCatalogFood :exec
INSERT INTO catalog_foods (
    barcode, name, brand, quantity, serving_size, serving_grams, kcal_100g,
    protein_100g, carbs_100g, fat_100g, sugar_100g, satfat_100g, fiber_100g, salt_100g,
    nutriscore, image_source_url, scans, dataset_version, imported_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (barcode) DO UPDATE SET
    name = excluded.name, brand = excluded.brand, quantity = excluded.quantity,
    serving_size = excluded.serving_size, serving_grams = excluded.serving_grams, kcal_100g = excluded.kcal_100g,
    protein_100g = excluded.protein_100g, carbs_100g = excluded.carbs_100g, fat_100g = excluded.fat_100g,
    sugar_100g = excluded.sugar_100g, satfat_100g = excluded.satfat_100g, fiber_100g = excluded.fiber_100g,
    salt_100g = excluded.salt_100g, nutriscore = excluded.nutriscore, image_source_url = excluded.image_source_url,
    scans = excluded.scans, dataset_version = excluded.dataset_version,
    imported_at = excluded.imported_at, updated_at = excluded.updated_at;

-- name: DeleteAllCatalogFoods :exec
DELETE FROM catalog_foods;

-- name: SetCatalogMeta :exec
INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- name: GetCatalogMeta :one
SELECT value FROM catalog_meta WHERE key = ?;

-- name: CountCatalogFoods :one
SELECT count(*) FROM catalog_foods;

-- name: SearchCatalog :many
SELECT c.*
FROM catalog_fts
JOIN catalog_foods c ON c.rowid_alias = catalog_fts.rowid
WHERE catalog_fts MATCH sqlc.arg(match)
ORDER BY bm25(catalog_fts, 10.0, 5.0, 50.0), c.scans DESC
LIMIT sqlc.arg(max_rows);

-- name: ListCatalogByBarcodes :many
SELECT * FROM catalog_foods WHERE barcode IN (sqlc.slice(barcodes));

-- name: SearchCatalogInfix :many
SELECT c.*
FROM catalog_trgm
JOIN catalog_foods c ON c.rowid_alias = catalog_trgm.rowid
WHERE catalog_trgm MATCH sqlc.arg(match)
ORDER BY bm25(catalog_trgm, 10.0, 5.0), c.scans DESC
LIMIT sqlc.arg(max_rows);
