-- name: GetSettings :one
SELECT user_id, goal_kcal, protein_g, carbs_g, fat_g, day_start_hour, theme, created_at, updated_at, deleted_at, server_seq
FROM settings WHERE user_id = ?;

-- name: UpsertSettings :exec
INSERT INTO settings (user_id, goal_kcal, protein_g, carbs_g, fat_g, day_start_hour, theme, created_at, updated_at, server_seq)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
    goal_kcal = excluded.goal_kcal,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    day_start_hour = excluded.day_start_hour,
    theme = excluded.theme,
    updated_at = excluded.updated_at,
    server_seq = excluded.server_seq;
