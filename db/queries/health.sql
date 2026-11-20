-- name: GetHealthRecord :one
SELECT * FROM health_records WHERE id = ? AND user_id = ?;

-- name: UpsertHealthRecord :execrows
INSERT INTO health_records (
    id, user_id, kind, recorded_on, recorded_at, value, medication, site, note,
    created_at, updated_at, deleted_at, server_seq
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
    kind = excluded.kind, recorded_on = excluded.recorded_on, recorded_at = excluded.recorded_at,
    value = excluded.value, medication = excluded.medication, site = excluded.site, note = excluded.note,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, server_seq = excluded.server_seq
WHERE health_records.user_id = excluded.user_id;

-- name: ListAllHealthRecords :many
SELECT * FROM health_records WHERE user_id = ? ORDER BY recorded_at, id;

-- name: CountLiveHealthRecords :one
SELECT count(*) FROM health_records WHERE user_id = ? AND deleted_at IS NULL;
