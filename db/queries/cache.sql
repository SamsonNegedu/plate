-- name: GetSearchCache :one
SELECT response FROM search_cache WHERE key = ? AND expires_at > ?;

-- name: PutSearchCache :exec
INSERT INTO search_cache (key, response, expires_at) VALUES (?, ?, ?)
ON CONFLICT (key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at;

-- name: PruneSearchCache :execrows
DELETE FROM search_cache WHERE expires_at <= ?;

-- name: GetImage :one
SELECT key, content_type, bytes, fetched_at, last_used_at, source_url FROM image_cache WHERE key = ?;

-- name: RegisterImage :exec
INSERT INTO image_cache (key, content_type, bytes, fetched_at, last_used_at, source_url)
VALUES (?, '', 0, '', ?, ?)
ON CONFLICT (key) DO NOTHING;

-- name: MarkImageFetched :exec
UPDATE image_cache SET content_type = ?, bytes = ?, fetched_at = ?, last_used_at = ? WHERE key = ?;

-- name: TouchImage :exec
UPDATE image_cache SET last_used_at = ? WHERE key = ?;

-- name: ClearImage :exec
UPDATE image_cache SET content_type = '', bytes = 0, fetched_at = '' WHERE key = ?;

-- name: ImageCacheBytes :one
SELECT coalesce(sum(bytes), 0) FROM image_cache;

-- name: ListImagesLRU :many
SELECT key, bytes FROM image_cache WHERE bytes > 0 ORDER BY last_used_at, key LIMIT ?;

-- name: DeleteSearchCache :exec
DELETE FROM search_cache WHERE key = ?;
