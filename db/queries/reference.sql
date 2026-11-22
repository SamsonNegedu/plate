-- name: InsertReferenceFood :exec
INSERT INTO reference_foods (
    ref_id, name, local_names, scientific_name, category, kcal_100g, protein_100g, carbs_100g, fat_100g,
    sugar_100g, satfat_100g, fiber_100g, salt_100g, estimated, source, dataset_version, imported_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: DeleteAllReferenceFoods :exec
DELETE FROM reference_foods;

-- name: GetReferenceFood :one
SELECT * FROM reference_foods WHERE ref_id = ?;

-- name: SearchReference :many
SELECT r.*
FROM reference_fts
JOIN reference_foods r ON r.rowid_alias = reference_fts.rowid
WHERE reference_fts MATCH sqlc.arg(match)
ORDER BY bm25(reference_fts, 10.0, 8.0, 2.0)
LIMIT sqlc.arg(max_rows);

-- name: CountReferenceFoods :one
SELECT count(*) FROM reference_foods;

-- name: GetReferenceVersion :one
SELECT dataset_version FROM reference_foods LIMIT 1;
