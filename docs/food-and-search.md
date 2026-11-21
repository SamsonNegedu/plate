# Food data and search

Where foods come from, how a barcode or a search becomes something you can log, and what keeps the data honest. Code: `internal/food`, `internal/search`, `internal/domain`; client side in `web/src/food` and `web/src/features/log`.

## Sources

| Source | What | Role |
|---|---|---|
| Catalog seed (`catalog_foods`) | about 70,000 German products built from the Open Food Facts dump, with per-100 g nutrition | answers the common case with no network call |
| Open Food Facts (live) | the full product record and images | the long tail, and refreshing stale rows |
| BLS | generic foods without a barcode, imported from a file on request (`PLATE_IMPORT_BLS_PATH`) | foods that have no label |
| Community facts | corrections and new products submitted by any account, shared by every account | outranks Open Food Facts and the catalog |
| User | custom foods entered by hand, private to the account | always wins over cached data |

The browser never talks to Open Food Facts. The server does, with bounded concurrency, a global rate cap (30 requests a minute), one retry, a circuit breaker, and redirects only within the same host.

## Looking up a barcode

`GET /foods/barcode/{code}` (`Service.Barcode`):

1. **Normalize.** Non-digits are dropped; 6 to 14 digits are accepted. A 12-digit UPC is also tried with a leading `0`, and a 13-digit code starting `0` is also tried without it.
2. **The user's own foods.** (A row whose nutrition came from a community fact carries `community_rev` and is never refreshed from Open Food Facts.) A live row for any candidate wins. If it came from Open Food Facts and was last checked over 90 days ago, a background refresh runs (at most once a day per food) without delaying the answer.
3. **A community fact.** If an accepted fact exists for the barcode it is copied into the user's `foods` (marked `community`) and returned, with no network call. A cached "not found" for the barcode is cleared when a fact is accepted, so a rescan finds it.
4. **The catalog.** A hit is copied into the user's `foods` as a `catalog` row and returned. No network call.
5. **A recent miss.** A "not found" answer is remembered for 24 hours.
6. **Open Food Facts.** The product is normalized and stored as an `off` row; a miss is remembered.

The client calls this only after its own Dexie cache misses, and a barcode lookup is limited to 60 a minute per user.

Outcomes the client handles: found, not found (opens the manual form with the barcode filled in), not loggable (a product exists but has no usable calories, so it opens the manual form with its name and says why), offline, upstream unavailable, and invalid.

## Community facts

A wrong or missing value on a known product is a fact about the product, so a correction is shared (ADR-020). `PUT /foods/barcode/{code}/correction` takes a person's version in Open Food Facts terms (energy in kcal and kJ, fat, saturates, carbohydrate, sugars, fibre, protein, salt per 100 g, plus name, brand, quantity, serving, language, ingredients and optionally a cropped label photo and a front photo, 400 KB and 250 KB). The client chooses the revision id, so a retry is the same submission.

- **Goes live at once** when the numbers pass the plausibility checks in `internal/food/plausibility.go`: energy within 15% of 4 x protein + 4 x carbohydrate + 9 x fat + 2 x fibre, saturates not above fat, sugars not above carbohydrate, protein + carbohydrate + fat at most 100 g, kJ within 5% of 4.184 x kcal, every value in range. Typed and scanned submissions are treated alike. A missing nutrient is skipped, never read as 0.
- **Stays private** when a check fails: the revision is stored, the response names the failed checks, and only the author sees it, through their own custom food.
- **Accepting** makes it the served revision, retires the previous one, clears the barcode's "not found" memory and rewrites every account's `off` or `catalog` row for that barcode through the change log. Logged entries keep their snapshots.
- **Open Food Facts never overwrites it.** A refresh or a search hit for a served barcode keeps the community numbers.
- **Disputes.** `POST /foods/barcode/{code}/dispute` from two accounts other than the contributor returns the product to its previous revision, or to the catalog row, or marks the cached row stale so Open Food Facts refreshes it. Disputing your own revision is a conflict.
- **Limits.** 50 submissions a day and 500 in total per account; `limit_reached` beyond that. An unplausible submission still counts.
- **Why no quorum.** With open signup and few accounts a second matching account would rarely appear, and two throwaway accounts would satisfy it. The accepted risk is a plausible wrong value that stays up until two others dispute it; the revision history keeps every earlier value.
- **Export.** `make off-export` writes the served facts in Open Food Facts field names, with the revision, source and photo flags, so they can be reviewed or pushed upstream later. Nothing is sent to Open Food Facts by the app.

## Values far outside the category

Arithmetic cannot catch every wrong label: someone saved a smoked salmon's per-100 g numbers as per-portion numbers, giving 399 kcal, 25 g fat and 43.75 g protein, and those still add up. The category does catch it: smoked salmons are typically 123 to 244 kcal.

- **Ranges.** `make catalog` computes, for every Open Food Facts category with 30 or more German products, the 5th percentile, median and 95th percentile of kcal, fat, protein, carbohydrate and salt over all of them (not only the products the seed keeps) and writes them to the seed's `category_stats` table. Each seed product carries its most specific category (the one covering the fewest products). The importer reads both, skips any malformed range, and replaces the table with the catalog.
- **Products from Open Food Facts.** A live fetch asks for `categories_tags`; the food gets the most specific tag that has ranges.
- **In a response.** A food that has a category carries `category: {name, ranges}`. The client decides: a value is outside when it is more than 25% above the 95th percentile (or below the 5th percentile divided by 1.25) and by more than a floor (40 kcal, 3 g fat or protein, 5 g carbohydrate, 0.3 g salt); a food is unusual when two or more nutrients are outside and one of them is energy, fat or protein. The product sheet then says "These values look unusual for smoked salmons. Check the label." It never blocks logging.
- **Calibration.** On about 1,900 live German products across six categories this flags 0 to 4% of products per category, mostly records that are genuinely misfiled; it flags the wrong salmon on energy, fat, protein and salt.
- **Old seeds.** A seed built before categories import as before, with no category and no warning, until the catalog is rebuilt from a dump.

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
   - **A word typed without umlaut keys still matches.** Both indexes fold ä ö ü to a o u but keep ß, so each word is matched in its spelling variants: `kaese`, `mueller`, `haehnchen` also match what the index holds for Käse, Müller, Hähnchen, and `weissbrot` and `soße` match both spellings of ß (`search.Variants`). A word with several spellings becomes an `OR` group, and groups are joined with an explicit `AND` because FTS5 does not read a group followed by a phrase as an implicit one.
   - **Each tier looks at 150 candidates, most scanned first.** A few letters match thousands of products, so the candidate pool is chosen by how often the catalog saw the product scanned (`scans`), then by text relevance. Choosing by text relevance first left the product people mean outside the pool.
3. If fewer than five local hits exist and the query is at least three characters, **Open Food Facts search** runs; its loggable hits are stored so the next query is local. A failure there just means the local results stand. Answers are cached for 24 hours (an empty answer for one hour). Open Food Facts matches whole words (`räucherl` finds only Räucherling, `vollk*` finds nothing), so a product outside the catalog and the person's own foods is found only once its words are typed in full; partial words are served from local data alone.

Results are ranked: favorite, recent, exact name, widely scanned (100 scans or more, so `nut` offers Nutella before the hundred products called "Nut"), whole word before prefix-only, native match before substring, name starts with the query, then source, then the order of the query (scans, then text relevance). Every result is loggable.

Recipes are searched on the device, not by this endpoint: a recipe whose name matches the query is listed above the foods, with its calories a portion and its portions, and its **+** opens the portion picker. When the search sheet is opened to pick a recipe ingredient, recipes are left out and a chosen food is added to the recipe instead of being logged.

The client also keeps a MiniSearch index over cached foods, so keystrokes show results at once; server queries are debounced 250 ms and aborted when the query changes. Server answers replace local duplicates, and local-only foods (not yet synced) stay below them.

## Images

Photos shared with a community fact (the cropped nutrition table and the front of the pack) are stored as BLOBs on the revision row and served at `GET /images/fact/{revision}/{front|nutrition}`. The URL names the revision, so its bytes never change and are cached for a year. Only the revision currently served for its barcode has public photos: a replaced, reverted or private revision answers 404. A community food's `image_path` points at its front photo only when the food has no Open Food Facts or catalog picture of its own; a picture it already has is never replaced. The shared photo fills a gap, nothing more.

Products have an image key, never a URL. `GET /images/{key}` (and `/images/catalog/{barcode}`) fetches from the single allowed host (`images.openfoodfacts.org`), checks the bytes are really an image rather than trusting `Content-Type`, stores the file on disk, and serves it from the same origin. That keeps the page's CSP strict and hides the user from the image host. The cache is bounded by `PLATE_IMAGE_CACHE_MB`; least-recently-used files are evicted. The browser caches images with the service worker.

## The catalog seed

The seed is a SQLite file built by `tools/catalog` from the Open Food Facts dump (German products with usable calories, deduplicated by barcode). On first boot, if `catalog_foods` is empty, the server imports it from the configured path or the bundled copy (`data/off-catalog.db`, `/seed/off-catalog.db` in the image). The import treats the file as untrusted: it opens it read-only, checks the tables and metadata, caps the size, and copies rows into the app's own table in one transaction. `PLATE_CATALOG_REIMPORT=true` replaces it on the next boot. The dataset version and row count are logged and shown in About. The data is ODbL; see [attribution.md](attribution.md).
