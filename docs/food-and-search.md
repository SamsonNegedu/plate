# Food data and search

Where foods come from, how a barcode or a search becomes something you can log, and what keeps the data honest. Code: `internal/food`, `internal/search`, `internal/domain`; client side in `web/src/food` and `web/src/features/log`.

## Sources

| Source | What | Role |
|---|---|---|
| Catalog seed (`catalog_foods`) | about 70,000 German products built from the Open Food Facts dump, with per-100 g nutrition | answers the common case with no network call |
| Open Food Facts (live) | the full product record and images | the long tail, and refreshing stale rows |
| BLS | generic foods without a barcode, imported from a file on request (`PLATE_IMPORT_BLS_PATH`) | foods that have no label |
| User | custom foods and corrections entered by hand | always wins over cached data |

The browser never talks to Open Food Facts. The server does, with bounded concurrency, a global rate cap (30 requests a minute), one retry, a circuit breaker, and redirects only within the same host.

## Looking up a barcode

`GET /foods/barcode/{code}` (`Service.Barcode`):

1. **Normalize.** Non-digits are dropped; 6 to 14 digits are accepted. A 12-digit UPC is also tried with a leading `0`, and a 13-digit code starting `0` is also tried without it.
2. **The user's own foods.** A live row for any candidate wins. If it came from Open Food Facts and was last checked over 90 days ago, a background refresh runs (at most once a day per food) without delaying the answer.
3. **The catalog.** A hit is copied into the user's `foods` as a `catalog` row and returned. No network call.
4. **A recent miss.** A "not found" answer is remembered for 24 hours.
5. **Open Food Facts.** The product is normalized and stored as an `off` row; a miss is remembered.

The client calls this only after its own Dexie cache misses, and a barcode lookup is limited to 60 a minute per address.

Outcomes the client handles: found, not found (opens the manual form with the barcode filled in), not loggable (a product exists but has no usable calories, so it opens the manual form with its name and says why), offline, upstream unavailable, and invalid.

## Normalization rules

`internal/food/normalize.go` and `internal/domain/sanitize.go`:

- A per-serving value is **never** read as per-100 g. Per-serving energy is converted only when the serving weight is known; a serving like "1 Riegel" with no weight stays unavailable.
- A missing nutrient stays `NULL`. A product without a usable name or calories is *not loggable* and is not stored.
- Impossible values are rejected rather than clamped. Names are cleaned and trimmed; junk (URLs, scraped label text, absurd length) is dropped from catalog names.
- A user's row is never overwritten by upstream data.

## Search

`GET /foods/search?q=` (`internal/food/search.go`, `internal/search`):

1. An exact barcode in the query is a barcode lookup.
2. Otherwise **local full-text search** over the user's foods and the catalog (SQLite FTS5). The query is split into letters and digits, so user input can never become FTS syntax (quotes, `*`, `:` and the like are separators). Whole-word matches are gathered first, then prefix matches, then substring matches through the trigram index (so "brot" finds "Vollkornbrot"). Queries shorter than two characters are not searched.
3. If fewer than five local hits exist and the query is at least three characters, **Open Food Facts search** runs; its loggable hits are stored so the next query is local. A failure there just means the local results stand. Answers are cached for 24 hours (an empty answer for one hour).

Results are ranked: favorite, recent, exact name, whole word before prefix-only, native match before substring, name starts with the query, then source, then bm25 order. Every result is loggable.

The client also keeps a MiniSearch index over cached foods, so keystrokes show results at once; server queries are debounced 250 ms and aborted when the query changes. Server answers replace local duplicates, and local-only foods (not yet synced) stay below them.

## Images

Products have an image key, never a URL. `GET /images/{key}` (and `/images/catalog/{barcode}`) fetches from the single allowed host (`images.openfoodfacts.org`), checks the bytes are really an image rather than trusting `Content-Type`, stores the file on disk, and serves it from the same origin. That keeps the page's CSP strict and hides the user from the image host. The cache is bounded by `PLATE_IMAGE_CACHE_MB`; least-recently-used files are evicted. The browser caches images with the service worker.

## The catalog seed

The seed is a SQLite file built by `tools/catalog` from the Open Food Facts dump (German products with usable calories, deduplicated by barcode). On first boot, if `catalog_foods` is empty, the server imports it from the configured path or the bundled copy (`data/off-catalog.db`, `/seed/off-catalog.db` in the image). The import treats the file as untrusted: it opens it read-only, checks the tables and metadata, caps the size, and copies rows into the app's own table in one transaction. `PLATE_CATALOG_REIMPORT=true` replaces it on the next boot. The dataset version and row count are logged and shown in About. The data is ODbL; see [attribution.md](attribution.md).
