-- name: InsertFactRevision :exec
INSERT INTO product_fact_revisions (
    id, barcode, contributor, source, origin, status, app_version, lang, countries, product_name, brands, quantity,
    serving_size, serving_grams, ingredients_text, energy_kcal_100g, energy_kj_100g, fat_100g, saturated_fat_100g,
    carbohydrates_100g, sugars_100g, fiber_100g, proteins_100g, salt_100g, label_image, front_image, submitted_at,
    accepted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetFactRevision :one
SELECT * FROM product_fact_revisions WHERE id = ?;

-- name: GetAcceptedFact :one
SELECT r.* FROM product_facts f JOIN product_fact_revisions r ON r.id = f.revision_id WHERE f.barcode = ?;

-- name: ListAcceptedFacts :many
SELECT r.* FROM product_facts f JOIN product_fact_revisions r ON r.id = f.revision_id WHERE f.barcode IN (sqlc.slice(barcodes));

-- name: GetProductFact :one
SELECT * FROM product_facts WHERE barcode = ?;

-- name: UpsertProductFact :exec
INSERT INTO product_facts (barcode, revision_id, status, updated_at) VALUES (?, ?, 'accepted', ?)
ON CONFLICT (barcode) DO UPDATE SET revision_id = excluded.revision_id, status = 'accepted', updated_at = excluded.updated_at;

-- name: SetProductFactStatus :exec
UPDATE product_facts SET status = ?, updated_at = ? WHERE barcode = ?;

-- name: DeleteProductFact :exec
DELETE FROM product_facts WHERE barcode = ?;

-- name: SetFactRevisionStatus :exec
UPDATE product_fact_revisions SET status = ?, accepted_at = ? WHERE id = ?;

-- name: SupersedeAcceptedRevisions :exec
UPDATE product_fact_revisions SET status = 'superseded' WHERE barcode = ? AND status = 'accepted' AND id != ?;

-- name: ListPendingRevisions :many
SELECT * FROM product_fact_revisions WHERE barcode = ? AND status = 'pending' ORDER BY submitted_at, id;

-- name: ListRevisionsForBarcode :many
SELECT * FROM product_fact_revisions WHERE barcode = ? ORDER BY submitted_at DESC, id DESC;

-- name: LatestSupersededRevision :one
SELECT * FROM product_fact_revisions WHERE barcode = ? AND status = 'superseded' ORDER BY accepted_at DESC, submitted_at DESC LIMIT 1;

-- name: InsertFactDispute :execrows
INSERT OR IGNORE INTO product_fact_disputes (barcode, revision_id, contributor, created_at) VALUES (?, ?, ?, ?);

-- name: CountFactDisputes :one
SELECT count(*) FROM product_fact_disputes WHERE revision_id = ?;

-- name: CountContributorRevisionsSince :one
SELECT count(*) FROM product_fact_revisions WHERE contributor = ? AND submitted_at >= ?;

-- name: CountContributorRevisions :one
SELECT count(*) FROM product_fact_revisions WHERE contributor = ?;

-- name: ListFoodsToRefreshForBarcode :many
SELECT * FROM foods WHERE barcode = ? AND source IN ('off', 'catalog') AND deleted_at IS NULL;

-- name: MarkFactRevisionPushed :exec
UPDATE product_fact_revisions SET pushed_at = ? WHERE id = ?;

-- name: ListAcceptedFactsForExport :many
SELECT r.* FROM product_facts f JOIN product_fact_revisions r ON r.id = f.revision_id ORDER BY r.barcode;

-- name: GetServedFactPhotos :one
SELECT r.label_image, r.front_image
FROM product_facts f JOIN product_fact_revisions r ON r.id = f.revision_id
WHERE f.revision_id = ?;

-- name: GetServedFactPhotoSizes :one
SELECT CAST(coalesce(length(r.label_image), 0) AS INTEGER) AS label_bytes, CAST(coalesce(length(r.front_image), 0) AS INTEGER) AS front_bytes
FROM product_facts f JOIN product_fact_revisions r ON r.id = f.revision_id
WHERE f.revision_id = ?;
