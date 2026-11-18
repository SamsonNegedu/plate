# Phase 5 — Food data, barcode lookup, and search

Status: done (client-side items noted below belong to Phases 8 and 9)
Depends on: 4
Blocks: 6, 8

## Goal

A barcode resolves to a trustworthy food in under a second, the no-match path is first-class, and search is fast in German. This phase owns every external data source and every normalization rule.

## Open Food Facts client

Endpoints used:

- Product: `GET /api/v2/product/{barcode}.json` with an explicit `fields` list.
- Search: `GET https://search.openfoodfacts.org/search?q=...&page_size=24&fields=...`, with `countries_tags_en=Germany` first and an unfiltered retry when the filtered result is thin.

Client rules:

- Timeout 10 s connect/read. No retry on 404. One retry on 5xx or network error.
- Global semaphore: 5 concurrent requests.
- Rate limits: 30 upstream requests/minute globally; 60 barcode lookups/minute per IP.
- Circuit breaker: opens after 5 consecutive upstream failures for 60 s; while open, return a cached result or a clear `upstream_unavailable` problem.
- `User-Agent` includes the app name and a real operator contact before public use.
- No user identifier is sent upstream.

## Normalization rules

These rules exist because the prototype had a real bug: a per-serving energy value could be read as per-100 g.

- `kcal_100g` comes from `energy-kcal_100g`. If absent, use `energy-kj_100g / 4.184`, then `energy_100g / 4.184` only when the field is known to be kJ.
- Never use `energy-kcal` or `energy-kj` (per serving) as a per-100 g value. If only per-serving data exists and `serving_quantity` is known, convert to per 100 g. Otherwise mark kcal missing and do not cache the food as loggable.
- Protein, carbs, fat, sugar, saturated fat, fiber, and salt come only from their `_100g` fields.
- Salt falls back to `sodium_100g * 2.5` when salt is absent.
- Missing values are `NULL`. Never coerce to zero.
- Nutri-Score is stored only for `a`–`e`.
- Serving grams come from `serving_quantity`, else a number followed by `g`/`ml` inside `serving_size`. A serving like "1 Riegel" with no grams stays unavailable.
- Brand is the first brand, trimmed. Name falls back to generic name, then brand. An unnamed product is not loggable and goes to the no-match path.
- `search_name` is lowercased, umlaut-folded (`ä→a`, `ö→o`, `ü→u`, `ß→ss`), punctuation collapsed to spaces.

Barcode handling:

- Strip non-digits; accept 6–14 digits.
- Try the exact code. If 12 digits, also try the zero-padded 13-digit form and the stripped form.
- Do not reject a product for a bad EAN checksum; OFF contains such records. Surface "barcode checksum looks unusual" only in debug logs.
- Never guess a different product for a near-match barcode.

## OFF catalog seed

The catalog is our own filtered OFF subset with nutrition. It is not a third-party identity file.

Build (release artifact, `make catalog`; a build-time Go program under `tools/`, not a runtime CLI):

- Stream the OFF dump; filter `countries_tags = Germany` and require `kcal_100g`.
- Normalize with the production rules, deduplicate by barcode, and rank by `scans_n`/`unique_scans_n` when available; otherwise use category and brand quotas.
- Default seed: 20k–50k rows. The full German subset (300k–500k) uses the same pipeline.
- Output a SQLite file with a `catalog_meta` table (version, built_at, row_count, source) and a `catalog_foods` table matching the app schema.
- Record ODbL attribution and the build inputs in the artifact.

Import:

- The seed is imported automatically when the catalog is empty; `PLATE_CATALOG_REIMPORT=true` replaces an existing catalog on one restart.
- Validate the schema and metadata, read the file read-only, copy in batches, and replace `catalog_foods` in one transaction.
- Store `dataset_version` and `imported_at`; log row count and version.
- Skip rows without kcal, empty or non-digit barcodes, and empty names. Deduplicate last-wins.
- Build `catalog_fts` in the same transaction.
- A failed import leaves the previous catalog intact.
- The catalog is excluded from the logical export and client sync; snapshots include the database file.

Catalog rows are loggable immediately. On first use, a catalog row is materialized into `foods` with `source='catalog'`, so entries, favorites, and the food sheet share one model. A catalog search result is materialized on selection. A user correction creates a `foods` row with `source='user'`, which shadows both the catalog and the materialized row on lookup. Catalog freshness comes from seed releases, not per-row revalidation.

## Lookup flow

1. Exact barcode in `foods` for the user → return immediately.
2. Exact barcode in `catalog_foods` → materialize a `foods` row with `source='catalog'` → return immediately; no OFF call.
3. Negative cache hit (`barcode:<code>` in `search_cache`, unexpired) → 404 `not_found`.
4. Fetch OFF.
5. On success: normalize, upsert `foods` with `source='off'`, store `source_id` and `source_updated_at`, return.
6. On 404: write a negative cache entry for 24 h and return `not_found` with a `can_add_manually` hint.
7. On upstream failure: return `upstream_unavailable` with `retry_after`. The client offers manual entry.

Upsert rule: never overwrite a row whose `source='user'`. A user correction wins forever.

A product with no kcal after normalization is not loggable. Return `422 not_loggable` with `reason: "no_nutrition"`, the product name, and the image key when available. Do not insert a zero-calorie food. The client offers manual entry or quick add.

## Freshness and revalidation

- Every successful OFF fetch sets `source_checked_at`.
- On a cache hit, serve the cached row immediately. If `source_checked_at` is older than 90 days and the food has been logged in the last 30 days, queue a background revalidation and update the row when it returns.
- Do not block the product sheet on a revalidation. The sheet shows "Checked 3 Nov" and the source.
- A row older than 90 days with no network shows "Last checked 3 Nov" and a stale hint; it is still loggable.
- A `source='user'` row is never revalidated or overwritten.
- If a revalidation changes kcal or macros, existing entries keep their snapshots; only future logs use the new values.
- Revalidation is deduplicated: one in-flight refresh per food, no more than once per 24 hours.

## Custom foods and corrections

`PUT /foods/{id}` creates a user food or corrects an existing one.

- A correction updates the existing row in place, sets `source='user'`, and keeps `source_id` for attribution. The original OFF values are gone; this is deliberate for a single-user app.
- A new custom food without a barcode uses `barcode NULL`.
- A custom food with a barcode takes the partial unique slot. If a live OFF row has that barcode, the correction updates that row rather than creating a duplicate.
- A "remove correction" action is out of scope for v1. The user can edit again or create a new food.

The client's manual food form requires name, kcal per 100 g, and optionally brand, serving size, and the other nutrients. `kcal_100g` is mandatory; the API rejects a food without it.

## Image proxy

- `foods.image_key` is a server-generated key, never a URL supplied by a client.
- Catalog rows carry `image_source_url`; a catalog hit is served through `/api/v1/images/catalog/{barcode}`, where the proxy looks up the allowlisted URL server-side. A client never supplies a URL, and the API never returns the raw source URL.
- `GET /api/v1/images/{key}` looks up the key, fetches from `https://images.openfoodfacts.org` only, enforces a 2 MB cap and an image content-type allowlist, caches to `data/images/<key>`, and serves with `Cache-Control: public, max-age=31536000, immutable`.
- The disk cache is bounded at 256 MB with LRU eviction by `last_used_at`.
- No upstream host other than the allowlist. No redirects followed to another host.
- The client requests same-origin image URLs only, which keeps the CSP tight and the offline cache reliable.

## BLS 4.0 import

- Download the official BLS 4.0 dataset from blsdb.de. It is free of charge since December 2025; record the exact edition and terms in the attribution file.
- Import runs from a one-shot startup flag: set `PLATE_IMPORT_BLS_PATH=/data/bls.csv`, restart, then remove it. The importer streams the file, maps ~7,100 generic foods, upserts by `source_id` with `source='bls'` and `barcode NULL`, logs counts, and leaves the process running. There is no separate CLI.
- Map kcal, protein, carbs, fat, fiber, sugar (if present), and salt/sodium. Missing values stay NULL.
- Idempotent: a second import updates existing rows and adds new ones. It never deletes user corrections.
- Add German synonyms for the top 100 generic foods only if the fixture queries fail without them (for example, `Apfel`, `Ei`, `Vollkornbrot`, `Kartoffel`).
- Attribution appears in the app's About screen and the export.

## German coverage strategy

A 50-barcode smoke test is a sample, not a strategy. Coverage is the product risk.

- `testdata/barcodes-de.csv`: at least 200 rows with `chain, product, barcode, expected_source` across Edeka, Rewe, Aldi Nord, Aldi Süd, Lidl, Kaufland, Penny, Netto, dm, and Rossmann. Include own-brands, branded staples, liquids, and a few known misses.
- `make coverage` runs the corpus against recorded fixtures, so CI is deterministic and does not hit OFF. It reports the share resolved locally (user cache + catalog) versus the share that needed OFF, per chain.
- `make coverage-live` is a manual target that hits OFF within the configured rate limits and updates a report. Never run it in CI.
- The client keeps local-only `foodMisses`: barcode, search query, timestamp, and a user note. Settings can copy or export them. They are never synced.
- The no-match sheet includes an "Add to Open Food Facts" link after the custom food is saved, with copy explaining that the local correction wins on this device.
- Acceptance target: at least 70% of the corpus resolves from the 50k catalog without OFF; at least 95% resolves overall with OFF. Every miss lands in the manual flow with the barcode prefilled.

## Search

### Server

Order:

1. Exact barcode in `foods`.
2. Exact barcode in `catalog_foods`.
3. FTS5 over `foods_fts` and `catalog_fts`.
4. OFF proxy if the local result count is below 5 and the query is at least 3 characters.
5. Empty state with manual-entry affordance.

Every returned result is loggable. OFF search hits without kcal are filtered out of the result list rather than shown as zero-calorie products.

FTS query construction:

- Trim, collapse whitespace, strip characters that have FTS syntax meaning (`"`, `*`, `(`, `)`, `:`, `^`, `-`).
- Tokenize on whitespace and punctuation.
- Quote each token; append `*` to the final token for prefix matching.
- Bind the result as a parameter to `MATCH`. Never concatenate raw user input into SQL.
- For queries under three characters, use `search_name LIKE 'query%'` with an index-friendly prefix.
- If FTS returns a syntax error, fall back to the LIKE path and log the query at debug level.

Ranking:

- `bm25(foods_fts, 10.0, 5.0, 50.0)` for name, brand, barcode.
- Re-rank the top 50 in Go: exact name match, name starts with query, favorite, recent, source priority (`user` > `bls` > `off`).
- Return at most 30.

Response fields: `id`, `barcode`, `name`, `brand`, `kcal100`, `servingSize`, `servingGrams`, `source`, `imageKey`, `nutriscore`.

German fixtures that must pass in the top 3: `joghurt`, `Joghurt`, `käse`, `Kase`, `Vollkornbrot`, `vollkorn`, `Müller`, `ja!`, `Gut & Günstig`, `Milbona`, `Hähnchenbrust`.

### Client

- MiniSearch over cached foods, indexed by name and brand, with barcode as an exact field.
- Results render from MiniSearch immediately; the server response replaces local results when it arrives.
- Debounce server queries at 250 ms; abort the previous request.
- Recent and favorite foods are pinned above search results.
- A failed server search keeps local results visible and shows a small "Search is offline" note.

## Caching and negative results

- `search_cache` key is a hash of the normalized query plus the Germany filter flag. TTL 24 h for hits, 1 h for empty results.
- `barcode:<code>` negative entries live in the same table with a 24 h TTL.
- Cache rows are pruned on startup and daily.
- A successful OFF search upserts the returned products, so the next identical query is local.

## Tests

Normalizer fixtures:

- Nutella (`3017620422003`), a ja! yogurt, a liquid with ml, a product with only per-serving data and a known serving quantity, a product with missing protein, a product with an invalid Nutri-Score, a product with no name.

OFF client:

- 200, 404, 429, timeout, malformed JSON, oversized body, and a 5xx that triggers one retry.
- Circuit breaker opens and closes on the expected schedule.

Cache and correction:

- A user correction is not overwritten by a later OFF fetch.
- A stale cached row triggers at most one background revalidation per 24 hours; a user correction never does.
- A product with no kcal returns `not_loggable` and is not inserted as a zero-calorie food.
- Catalog import: re-import is idempotent, a bad file leaves the old catalog, duplicate barcodes resolve last-wins, and rows without kcal are skipped.
- A catalog hit materializes one `foods` row with `source='catalog'` and makes no OFF call.
- A user correction shadows the catalog and its materialized row on lookup.
- Search merges `foods` and `catalog_foods` without duplicate barcodes.
- Negative cache prevents a second upstream call.
- Image key cannot be used to fetch an arbitrary host.

Search:

- Every German fixture query top-3.
- Punctuation queries do not error.
- Prefix search works.
- Barcode exact match ranks first.
- Favorite and recent boosts apply.

BLS:

- Import twice yields the same row count.
- User corrections survive re-import.
- Missing nutrients stay NULL.

## Acceptance

- 50 real German barcodes from Edeka, Rewe, Aldi, Lidl, Kaufland, dm, and Rossmann are tested. At least 40 resolve; the rest land in the no-match flow without an error.
- Cached barcode lookup p95 under 50 ms; online p95 under 800 ms.
- Search p95 under 20 ms server-side; keystroke-to-local-result under 50 ms.
- No per-serving value is ever stored as per-100 g.
- Every image request is same-origin in the browser.
- The About screen and export carry OFF (ODbL) and BLS attribution.

## Deliverables

- [x] OFF client with timeout, retry, rate limit, circuit breaker, and negative cache.
- [x] Normalizer with the fixture suite.
- [x] Barcode lookup, custom food, correction endpoints.
- [x] Image proxy and disk cache.
- [x] BLS importer and attribution.
- [x] FTS5 search endpoint, ranking, OFF fallback, query cache.
- [x] OFF catalog seed builder (`make catalog`), importer, catalog search, and dataset version.
- [x] `testdata/barcodes-de.csv`, `make coverage`, and `make coverage-live`.
- [x] Freshness/revalidation with `source_checked_at`.
- [ ] Local-only miss logging and the Open Food Facts contribution link. Client-side; lands in Phase 8.
- [x] Client-facing search contract and fixture results.
- [x] `docs/attribution.md`. The server exposes `GET /about` and writes attribution into every export; the About screen itself is Phase 9.

## Out of scope

A full OFF bulk import, OCR of labels, user-contributed photos, and multi-language names.

## Note

Verified: `make verify` exits 0 (lint 0 issues; about 150 Go tests across `food`, `search`, `httpapi`, `sync`).

Measured on the real data (OFF dump of 2026-11-12, BLS 4.0 data file, both downloaded for this build):

| Check | Result |
|---|---|
| BLS import of the real file | 7,140 of 7,140 foods |
| Catalog seed | 70,839 products with at least 2 unique scans; 17.2 MB seed; imports in 11 s; app database grows to 37 MB with both FTS indexes |
| Share of all German scan volume the seed covers | 86.1% (the earlier 50k seed: 77%) |
| German barcode corpus (`internal/food/testdata/barcodes-de.csv`, 233 rows over 10 chains plus 10 known misses) | 90.9% resolved from the catalog without OFF (target 70%); 100% resolved overall; the 10 misses and 1 product OFF lists without kcal land in the manual flow |
| Search p95 on the real 70k seed | worst of 15 German queries 16.5 ms (budget 20 ms), others 3-12 ms |
| Cached barcode lookup p95 | 40 microseconds (budget 50 ms) |

Decisions made while building:

- **Seed size is "every product with at least 2 unique scans", not "top 50k".** The Spike F cutoff fell inside a tie of 25,000 products with exactly 2 scans, which gave an arbitrary split and only 56% corpus coverage. A hard cutoff gives 70,839 rows and 91%. `make catalog MIN_SCANS=1` widens it. ADR-015 is updated.
- **A trigram index was added.** Word-prefix search cannot find German compounds: in the real seed, 774 of 1,118 products containing "käse" and 425 of 684 containing "brot" (Frischkäse, Vollkornbrot) are word-interior matches. `foods_trgm` and `catalog_trgm` (`trigram remove_diacritics 1`) add a third ranking tier after whole-word and prefix hits. ADR-007 is updated.
- **Ranking:** favorite, recent, exact name, whole-word, then substring, then name prefix, source, bm25 (`ja!` now ranks the `Ja!` brand products above `Jana jagoda guava`).
- **Seed build cleans data:** drops URL and scraped-label names, merges near-duplicates that differ only in case, accents or punctuation (23,472 merged), and keeps only allowlisted image URLs.
- **The corpus is an estimate, not the operator's shopping.** It samples real German products per chain from the dump, restricted to products with at least 2 scans, which the seed also requires. Treat 90.9% as "how much of what people scan", and the scan-volume figure (86.1%) as the better single number. The CI run of `make coverage` without the release seed checks that the pipeline reproduces every recorded classification; with `PLATE_COVERAGE_SEED` it measures coverage.
- OFF's search API returns `brands` as an array, the product API as a string; the normalizer accepts both. OFF sometimes lists a product with no nutriments even though the dump has kcal (5 of 223 corpus rows); these return `422 not_loggable`.
- sqlc cannot parse `sqlc.arg` combined with `BETWEEN`, and needs a stub for FTS5 hidden columns; both handled in Phase 2.

Not verified: a live `make coverage-live` end to end from a clean checkout beyond what the corpus tool already did; the revalidation job against live OFF; Open Food Facts rate limits under real daily use (the recorder hit a 429 once at about 27 requests a minute and now backs off at 18); whether the ODbL share-alike applies to a private deployment (documented conservatively in `docs/attribution.md`).
