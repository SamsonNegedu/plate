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
| `users` | the single account: email, Argon2id hash, last login | no |
| `sessions` | server-side sessions; only the SHA-256 of the cookie token is stored | no |
| `settings` | calorie goal, macro targets, day start hour, theme | yes |
| `foods` | the user's food cache and custom foods (sources `off`, `bls`, `user`, `catalog`) | yes |
| `entries` | one logged portion, with the full per-100 g nutrition snapshot | yes |
| `saved_meals` | a named meal template | yes |
| `saved_meal_items` | the template's items, replaced atomically with their meal | yes (inside `saved_meals`) |
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

## Client-side tables (Dexie)

The browser keeps its own IndexedDB (`web/src/db/schema.ts`): `entries`, `foods`, `settings`, `savedMeals`, `savedMealItems`, `favorites`, plus device-only `foodPrefs` (last portion per food), `foodMisses` (barcodes that were not found), `outbox` (pending writes), `meta` (cursor, backoff, leader lease) and `conflicts` (writes the server flagged as overwriting a newer row).
