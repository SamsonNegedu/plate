# Data model

One SQLite file (WAL mode, `modernc.org/sqlite`, FTS5). Migrations are goose SQL in `db/migrations` and are the source of truth for columns and constraints; queries are sqlc in `db/queries`. This page explains the shape and the rules.

## Conventions

- Timestamps are UTC RFC 3339 text. Local calendar dates (`eaten_on`) are `YYYY-MM-DD` text, assigned by the client.
- Nutrition is stored **per 100 g or 100 ml** in `*_100g` columns. `kcal_100g` is required; protein, carbs, fat, sugar, saturates, fibre and salt are nullable, and `NULL` means "not reported", never `0`.
- Every syncable table has `created_at`, `updated_at`, `deleted_at` (a tombstone when set) and `server_seq` (the `change_log` sequence of its last change).
- IDs are text UUIDs. Entries use client-generated UUIDv7, so a retried create is the same request.

## Tables

| Table | Holds | Synced |
|---|---|---|
| `users` | one row per account: username, Argon2id hash, last login, whether the recovery codes were confirmed saved | no |
| `recovery_codes` | an account's single-use reset codes; only a SHA-256 of each is stored | no |
| `sessions` | server-side sessions; only the SHA-256 of the cookie token is stored | no |
| `settings` | calorie goal, macro and fibre targets, day start hour, theme, and the optional weight goal and medication plan (name, days between doses, start date, doses on hand) | yes |
| `foods` | the user's food cache and custom foods (sources `off`, `bls`, `user`, `catalog`) | yes |
| `entries` | one logged portion, with the full per-100 g nutrition snapshot | yes |
| `saved_meals` | a recipe: a name, the portions it makes (`servings`, 1 for meals saved before recipes) and its ingredients | yes |
| `saved_meal_items` | the recipe's ingredients with their nutrition snapshot, replaced atomically with the recipe | yes (inside `saved_meals`) |
| `health_records` | one dated number the person logs: a weight (kg), a body measurement (cm: waist, hips, chest, arm, thigh or neck), an appetite or nausea rating (0 to 5) or a medication dose (mg, with the medication and injection site) | yes |
| `favorites` | a relation between the user and a food; removal is a tombstone | yes |
| `catalog_foods` | the bundled Open Food Facts German seed, with nutrition; reference data | no |
| `catalog_meta` | the seed's dataset version and import time | no |
| `change_log` | per-user ordered stream of changes that clients pull | no |
| `sync_state` | per user: `min_seq` and `head_seq` of the stream | no |
| `sync_ops` | applied `op_id`s and their results, for idempotent replay | no |
| `search_cache` | cached Open Food Facts search answers and "barcode not found" markers, with expiry | no |
| `image_cache` | metadata for product images stored on disk; least-recently-used files are evicted past the size limit | no |
| `meta` | key/value, including `schema_version` | no |
| `foods_fts`, `catalog_fts` | FTS5 indexes over name, brand and barcode, kept current by triggers | derived |
| `foods_trgm`, `catalog_trgm` | trigram indexes for substring matches inside German compounds | derived |

## Rules worth knowing

- **Snapshot on entries.** An entry copies the food's name, brand, barcode and all nutrition when logged. `food_id` is a plain reference (`ON DELETE SET NULL`), so deleting or correcting a food never changes history.
- **One live barcode per user.** `foods_live_barcode` is a partial unique index on `(user_id, barcode)` for rows that are not tombstoned.
- **Catalog rows are not user data.** They are replaced wholesale on import and never synced. The logical export does not include the `catalog_foods` table (a backup restores into a server that already has its own seed). A catalog row becomes a `foods` row only when someone looks it up or logs it.
- **Retention.** Change-log rows and `sync_ops` older than 180 days are pruned, and each affected user's `min_seq` moves up. A device whose cursor falls below `min_seq` must take a fresh snapshot ([sync.md](sync.md)). Tombstones in the entity tables stay.
- **Search names.** `foods.search_name` holds a folded form (case, umlauts, punctuation) used for exact and prefix comparison.

- **Recipes are saved meals.** `saved_meals.servings` is the portions a recipe makes (1 for meals saved before recipes). Its items keep a nutrition snapshot like an entry, so a recipe never changes when a food does. Logging a recipe writes one entry named after it, with `brand` set to "Recipe" and the recipe's nutrition per 100 g of ingredients as the snapshot, so any number of portions is exact.
- **Health records** share one table: `kind` is `weight` (kg), `waist`, `hips`, `chest`, `arm`, `thigh` or `neck` (cm), `appetite` or `nausea` (a whole number 0 to 5), or `dose` (mg, with `medication` and `site`). The kind decides the allowed range, which is enforced in the database as well as the API. `recorded_on` is the local calendar day the client assigned; `recorded_at` is the moment. Doses of a medication are matched by name, ignoring case.
- **Plan and goals live on `settings`.** `weight_goal_kg`, `med_name`, `med_interval_days`, `med_started_on`, `med_supply_doses` and `med_supply_as_of` describe the optional weight goal and medication plan, and `fiber_g` is the fibre target. Null (or 0 for a target) means not set; saving settings replaces the whole object, so leaving the plan out clears it.
- **Two migrations rebuild a table.** SQLite cannot change a `CHECK`, so `00013` rebuilds `change_log` (adding the `health_record` entity, carrying the sequence counter over) and `00015` rebuilds `health_records` (adding the measurement kinds). Both keep every row.

## Client-side tables (Dexie)

The browser keeps its own IndexedDB (`web/src/db/schema.ts`): `entries`, `foods`, `settings`, `savedMeals`, `savedMealItems`, `healthRecords`, `favorites`, plus device-only `foodPrefs` (last portion per food), `foodMisses` (barcodes that were not found), `outbox` (pending writes), `meta` (cursor, backoff, leader lease) and `conflicts` (writes the server flagged as overwriting a newer row).
