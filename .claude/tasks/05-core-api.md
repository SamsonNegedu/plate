# Phase 4 — Core API

Status: done
Depends on: 3
Blocks: 5, 6, 7

## Goal

The log itself: settings, entries, day totals, history ranges, and export/import. This is the contract the client builds against.

## Endpoints

### Settings

`GET /settings` returns goals, macro targets, `day_start_hour`, `theme`, `last_login_at`, and the server's current date.

`PUT /settings` validates and replaces the settings object.

Rules:

- `goal_kcal` 500–9000.
- Macro targets 0–500 g; 0 means "not tracked", not "zero allowed".
- `day_start_hour` 0–23. This is a display/assignment setting; the client decides which `eaten_on` a late-night entry belongs to.
- `theme` is `auto`, `light`, or `dark`.
- `updated_at` and `server_seq` are server-set.

### Day and entries

`GET /days/{date}` returns:

- `date`
- `entries`: every live entry for the local date, ordered by `created_at`, then `id`.
- `totals`: kcal, protein, carbs, fat, count.
- `missing`: nutrient names for which at least one entry has no value.
- `goal`: kcal and macro targets at read time.

`GET /days?from=&to=` returns per-day totals for a range. Limit 366 days. Return every date in the range, including zero days, so the chart does not have to invent them. Unknown dates are rejected.

`PUT /entries/{id}` creates or updates. The ID is a client-generated UUIDv7. This is the only create path; there is no `POST /entries`.

Body:

- `eaten_on`, `meal`, optional `food_id`
- `name`, `brand`, optional `barcode`
- `amount`, `unit`, `grams`
- the per-100 g snapshot: `kcal`, `protein`, `carbs`, `fat`, optional `sugar`, `satfat`, `fiber`, `salt`
- optional `note`
- `client_updated_at`

Validation:

- ID is a valid UUID. A non-UUID is a 422.
- `eaten_on` is a real date and not more than one day in the future.
- `meal` is one of the four values.
- `amount > 0`, `grams > 0`, `kcal_100g >= 0`; other nutrients are null or >= 0.
- `unit` is `g`, `ml`, `piece`, or `serving`.
- For `unit=g` or `ml`, `grams` must equal `amount` within 0.01; reject mismatches.
- For `piece` or `serving`, `grams` is trusted as the normalized portion. The client must have a serving size to offer those units.
- If `food_id` is present, it must exist and belong to the user. The snapshot still comes from the request so offline edits work; the server does not silently replace it. The single-user trust boundary makes this acceptable.
- Setting `note` is optional; cap at 500 characters.
- Unknown JSON fields are rejected.

Semantics:

- If the row does not exist, insert.
- If it exists and is live, update (entity-level last write wins).
- If it exists and is tombstoned, return `409 tombstoned` unless the request explicitly asks to restore a just-undone entry (see undo below).
- The server sets `updated_at` and appends a change-log row.

Undo:

- The client keeps a 5-second undo toast.
- If the delete has not synced, the client cancels the outbox op and undeletes locally. No server call.
- If it has synced, undo creates a new entry with a new ID. The old tombstone stays. No resurrection.

`DELETE /entries/{id}` tombstones the entry. Idempotent: deleting an already-deleted entry returns 204.

`GET /entries/{id}` returns one entry, mainly for debugging and conflict views.

### Export and import

`GET /export` returns a JSON document:

- `format_version` (integer, currently 1), `schema_version`, `exported_at`, `app_version`
- `settings`
- `entries` (all, including tombstones? Export live entries only, plus a tombstone list for fidelity)
- `foods` referenced by entries, all custom foods, and all favorites
- `saved_meals` and items
- `favorites`

It does not include the entire OFF cache. A restore must work without the cache.

`POST /import` accepts the same document and replaces all data in one transaction. Before replacing, write a pre-import snapshot. Merge mode is out of scope for v1; the UI presents replace as destructive and asks for confirmation. Validate the whole document before touching the database.

Versioning rule: a new exporter must keep importing the previous `format_version` for at least one release. The importer rejects an unknown newer version before writing. Tests keep a frozen N-1 export fixture.

### Health

`/healthz` and `/readyz` are implemented in Phase 1; this phase adds a DB read and migration check to `readyz`.

## Date and timezone policy

- The client assigns `eaten_on` when the entry is created, from the device's local date and the configured `day_start_hour`.
- The server stores that date verbatim. It never derives or rewrites it from a timestamp, a timezone, or the current server date.
- "Today" in the UI is always the device's local date. History and day endpoints take explicit dates.
- Travel: existing entries keep the date they were logged on. New entries use the new local date. Changing the device timezone does not move old entries.
- A late-night entry with `day_start_hour=4` and a local time of 00:30 belongs to the previous date. The client shows a small "late night" note so the date is not surprising.
- Date arithmetic uses calendar dates, not UTC offsets. DST transitions are tested explicitly.
- Server timestamps (`created_at`, `updated_at`) are UTC RFC 3339. Dates are plain `YYYY-MM-DD`, never timestamps.
- Entries cannot be dated more than one day in the future. Past dates are allowed.

## Nutrition math

- Entry kcal = `kcal_100g * grams / 100`.
- Entry macros use the same formula.
- Day totals sum unrounded entry values, then round for display.
- Missing nutrients do not count as zero. The API returns `missing` so the UI can show `—` and an explanatory hint.
- Calories are rounded to the nearest integer; macros to one decimal in the UI, stored full precision.
- Liquids use 1 ml = 1 g until a density field exists. The UI labels this approximation.

## Error model

RFC 9457 problem details. Stable `code` values:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed JSON or query |
| 401 | `unauthorized` | No valid session |
| 403 | `forbidden` | Origin/CSRF or proxy trust failure |
| 404 | `not_found` | Entry, food, or day not found |
| 409 | `tombstoned` | Entry was deleted |
| 422 | `validation_failed` | Field-level errors |
| 429 | `rate_limited` | Retry later |
| 500 | `internal` | Never includes internals |

Every response carries `request_id` in the body and the `X-Request-ID` header.

## Request limits

- 1 MB body cap on JSON routes.
- 60 requests/minute per session for general API reads; 120/minute for sync.
- Huma validates the schema; domain checks run before the transaction.

## Tests

- PUT twice with the same ID creates one row.
- PUT an existing live row updates it and appends one change-log row.
- PUT with a mismatched `grams` for `unit=g` returns 422.
- DELETE twice returns 204; the row is tombstoned once.
- A tombstoned entry cannot be updated without explicit restore.
- Day totals match hand-calculated fixtures.
- Missing macros produce `missing`, not zero.
- Date range limit and invalid dates.
- Export → import round-trip preserves entries, snapshots, settings, saved meals, favorites.
- Import accepts the frozen N-1 fixture and rejects an unknown newer format.
- Import rejects a bad schema version before writing.
- Date policy: an entry logged at 00:30 with day_start_hour 4 lands on the previous date; a timezone change does not move existing entries; DST transitions do not duplicate or skip a date.
- Unauthorized requests return 401 on every route.
- Problem responses never include SQL or stack traces.

## Deliverables

- [x] Settings endpoints and validation.
- [x] Entry PUT/DELETE/GET with idempotency and tombstones.
- [x] Day and range totals with missing-nutrient reporting.
- [x] Export/import with pre-import snapshot.
- [x] OpenAPI operations and generated TypeScript types.
- [x] Integration tests and curl examples.

## Verification

- `go test ./internal/httpapi/...`.
- `curl` examples for create, update, delete, day, range, export, import.
- OpenAPI document includes every route and error schema.
- TypeScript generation diff is clean.
- A day with a 0 kcal entry still shows 0, not "missing".

## Out of scope

Food lookup, search, sync, and the UI. This phase exposes the log contract only.

## Note

Verified: `make verify` exits 0. About 45 HTTP-level tests plus service, domain and backup tests cover the test list above, except the items listed under "Not done". A `curl` run against the built binary exercised create, update, delete twice, day, range, export and import. A Go test fails if `internal/httpapi/openapi.json` is stale, and `web/src/api/schema.d.ts` is generated from it.

Decisions made while building:

- All writes go through `internal/sync` (`ApplyEntry`, `ApplyEntryDelete`, `ApplySettings`). A change-log row is reserved first, the row is written with that `server_seq`, then the payload is stored, all in one `BEGIN IMMEDIATE` transaction. Phase 6 push will call the same functions.
- Upserts carry `WHERE user_id = excluded.user_id` and report a conflict if no row changed, so a client can never overwrite another user's row by reusing an ID.
- No "restore a just-undone entry" flag: undo before sync cancels the op locally, after sync it creates a new entry. A tombstoned ID always returns `409 tombstoned`.
- Import needs `?mode=replace`. Replace tombstones entries, foods, saved meals and favorites that the backup lacks and writes every change to the change stream, so other devices converge without a forced snapshot. A tombstoned row present in the backup is restored; a cached food whose barcode already exists under another ID is remapped to the existing row.
- Day totals sum unrounded entries and round once. A 0 kcal entry counts as a value; `missing` lists macros that at least one entry did not report.
- `Huma` is configured without `$schema` links, so an export re-imports unchanged. Request bodies reject unknown fields. Embedded wire types carry no methods because Huma cannot add a `$schema` field to embedded types with methods.
- Per-user rate limits are 60 requests a minute for the API and 120 for `/sync/*`.
- `typescript` is pinned to 5.9.3: `openapi-typescript` 7 does not run on TypeScript 7.

Not done in this phase: the date-policy tests that depend on the client (a 00:30 entry with `day_start_hour` 4 landing on the previous date, a device timezone change) belong to the client phases; the server side (stores `eaten_on` verbatim, calendar-date ranges across DST) is tested. The `readyz` migration check was already added in Phase 1.
