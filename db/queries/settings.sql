-- name: GetSettings :one
SELECT user_id, goal_kcal, protein_g, carbs_g, fat_g, fiber_g, day_start_hour, theme,
       weight_goal_kg, med_name, med_interval_days, med_started_on, med_supply_doses, med_supply_as_of,
       created_at, updated_at, deleted_at, server_seq
FROM settings WHERE user_id = ?;

-- name: UpsertSettings :exec
INSERT INTO settings (
    user_id, goal_kcal, protein_g, carbs_g, fat_g, fiber_g, day_start_hour, theme,
    weight_goal_kg, med_name, med_interval_days, med_started_on, med_supply_doses, med_supply_as_of,
    created_at, updated_at, server_seq
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
    goal_kcal = excluded.goal_kcal,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    fiber_g = excluded.fiber_g,
    day_start_hour = excluded.day_start_hour,
    theme = excluded.theme,
    weight_goal_kg = excluded.weight_goal_kg,
    med_name = excluded.med_name,
    med_interval_days = excluded.med_interval_days,
    med_started_on = excluded.med_started_on,
    med_supply_doses = excluded.med_supply_doses,
    med_supply_as_of = excluded.med_supply_as_of,
    updated_at = excluded.updated_at,
    server_seq = excluded.server_seq;
