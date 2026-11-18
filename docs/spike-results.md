# Phase 0 spike results

Date: 2026-11-13. The throwaway spike code was removed after these results. Nothing here ships.

| Spike | Result | Verified how |
|---|---|---|
| A. Barcode scan on devices | not run | needs real iOS/Android devices over HTTPS |
| B. German FTS5 search | go, with two design changes | `spikes/fts`, `go run .`, darwin/arm64, modernc v1.62.0 |
| C. modernc + goose + sqlc + Huma | go, with one workaround | `spikes/stack`, `go test -race -count=3`, `sqlc diff`, two static builds |
| D. Sync paper test | paper only, no two-tab prototype | table below |
| E. Cloudflare Tunnel + Access | not run | needs the operator's Cloudflare account and a phone |
| F. OFF catalog seed build | go at 50k, partial (no real corpus) | `spikes/seed`, OFF CSV dump of 2026-11-12 (1.5 GB gz), streamed |

## Spike B

Setup: 102,008 rows (100k synthetic, 2k more synthetic, 8 planted fixtures), FTS5 external content, `unicode61 remove_diacritics 2`, `prefix='2 3'`, insert trigger, `bm25(foods_fts, 10, 5, 50)`, 500 runs per query.

Caveat: there is no network dump here, so the "2,000 real OFF names" are synthetic German-style names. Re-run against real OFF names in Spike F.

| Rows | Result |
|---|---|
| 50k | every fixture passes, worst p95 11.9 ms (`vollkorn`) |
| 102k | every fixture in the top 3; `vollkorn`, `ja`, `Kase` p95 sit at 20.0-20.8 ms, right on the budget line |

Findings and decisions:

- Quoting every token (`"gut" "günstig"*`) removes all FTS syntax errors for `ja!` and `Gut & Günstig`.
- Umlaut folding works: `Kase` finds `Käse`, `kase*` and `käse*` behave the same.
- Change: drop the `LIKE` fallback for queries under three characters. It was 23-28 ms at 100k rows and missed brand matches. An FTS5 prefix index (`prefix='2 3'`) handles short queries in 6-12 ms and searches brand too. `00-architecture.md` ADR-007 needs this edit.
- The slow cases are high-fan-out prefixes where thousands of rows tie and bm25 must score them all. At the planned 20k-50k seed this is well inside budget; at 100k+ it is not. Keep the seed at 50k or below, or cap candidates.
- Compounds: `brot` does not find `Vollkornbrot`. Prefix search only matches word starts. No trigram index yet because no fixture requires infix. Decide after the real-name run.
- Top-3 rule for ambiguous queries (`vollkorn`, `ja`): thousands of rows match equally, so the check is that the top 3 are all relevant, not that one named product wins.

## Spike C

Passes:

- `sqlc generate` reads the goose migrations directly. It ignores the `Down` section and registers the FTS5 table with its declared columns.
- FTS5 queries and triggers work through `modernc.org/sqlite`.
- 64 concurrent `BEGIN IMMEDIATE` writers all succeed with `busy_timeout(5000)`. No `SQLITE_BUSY`, no retry loop needed at this load. Race detector clean.
- Huma on chi serves a POST and GET. The OpenAPI 3.1 document lists both operations. A missing row returns 404.
- `CGO_ENABLED=0` builds for darwin/arm64 (17 MB) and linux/amd64 (18 MB, statically linked).
- `sqlc diff` is clean.

Workaround to carry into Phase 2: sqlc rejects `notes_fts MATCH ?` and `bm25(notes_fts)` because it does not know the hidden columns. Add a sqlc-only stub (never applied to a database) listed second under `schema:`:

```sql
ALTER TABLE notes_fts ADD COLUMN notes_fts TEXT;
ALTER TABLE notes_fts ADD COLUMN rank REAL;
```

Redefining the table instead of altering it fails with `relation already exists`. The generated `MATCH` parameter is `sql.NullString`. Generated `models.go` also includes an FTS row struct that is unused.

## Spike D: sync cases

Each row needs a matching Phase 6 test. Not yet run against a prototype.

| # | Case | Defined behavior |
|---|---|---|
| 1 | Create offline, close tab, reopen, sync | The entry and its outbox row commit in one Dexie transaction, so both survive the reload. The drainer sends the op with its original `op_id`. |
| 2 | Create on A and B offline, then sync | IDs are client UUIDv7, so no collision. The server applies in receive order and both appear in the pull stream. |
| 3 | Edit on A, delete on B, either order | Delete first: the edit is rejected and the tombstone is returned. Edit first: the delete wins and sets `deleted_at`. A synced tombstone is never resurrected. |
| 4 | Same batch pushed twice | `sync_ops` holds applied `op_id`s. The second push returns the stored results and writes nothing. |
| 5 | Pull a page, crash, resume | The client applies a page and advances its cursor in one Dexie transaction. After a crash it re-pulls from the last committed cursor. Re-applying a change is idempotent by `server_seq`. |
| 6 | Cursor below `sync_state.min_seq` | Pull returns `resync_required`. The client discards local synced state and takes a snapshot. Unsent outbox rows must be kept and replayed after the snapshot. Open question: replay order against the new snapshot. |
| 7 | One op fails validation | The server returns a per-op result. The failed op is marked in the outbox and shown in Settings. Other ops still apply. |
| 8 | Two tabs draining | `navigator.locks` elects one drainer. The fallback is a Dexie lease row with a 15 s expiry. If both ever send, case 4 makes the second a no-op. |

Open question from case 6: after a forced snapshot, do queued local entries replay as new ops, or are they dropped? The architecture doc is silent. Recommend replay, since entries are idempotent by ID.

## Spike F

Dump: `en.openfoodfacts.org.products.csv.gz`, 1.5 GB gzipped, 4,908,651 products. Parse: 42 s, 1.8 GB peak RSS (the builder holds every eligible row; a CI build can keep only the top N).

Funnel:

| Step | Rows |
|---|---|
| In the dump | 4,908,651 |
| `countries_tags` has `en:germany` | 438,956 |
| Dropped: no kcal | 174,813 |
| Dropped: empty or invalid name | 20,536 |
| Dropped: bad barcode | 829 |
| Dropped: impossible macros | 522 |
| Dropped: kcal out of range | 186 |
| Eligible, deduplicated | 242,070 |

Only about 165k of those have any scans (77,214 have none). The dump has no Germany-only export; filtering the global file is the only route.

Seed sizes, ranked by `unique_scans_n`:

| Seed | Share of scan volume | File (SQLite + FTS5) | Import | FTS p95 |
|---|---|---|---|---|
| top 5k | 41.3% | not built | - | - |
| top 20k | 61.0% | 7.6 MB | 0.2 s | < 0.6 ms |
| top 50k | 77.0% | 18.6 MB | 0.6 s | < 1.3 ms |
| all 242k | 100% | not built | - | - |

Decision: default seed is 50k. It is the only size that clears 70% on the proxy below, the file is small, and search is far inside budget on real names (the synthetic run in Spike B was the pessimistic case).

Caveats:

- The 200+ product corpus does not exist yet, so the pass criterion (70% resolved without OFF) is only approximated by share of OFF scan volume. That measures what OFF users scan, not what this user eats. Build the real corpus before Phase 5 exit.
- Not verified: byte-identical output across two runs (the sort is deterministic, but I did not diff), compressed size, a top-5k starter pack, and the ODbL attribution and share-alike obligations for the distributed seed.
- I used OFF's `_100g` columns as given and did not check how OFF derived them for products entered per serving. Phase 5's normalizer must still follow the "never treat a per-serving value as per-100 g" rule.
- Quality problems in the 50k seed: brand blank on some rows, near-duplicates differing in case or spelling (`muller Kefir`, `Gut und Günstig`), non-German products (`Sødergarden`), and junk text in names (`... NUTRI-SCORE ABCDE edeka.de/nu`). Phase 5 needs name cleanup and near-duplicate merging.
- Ranking: with 50k rows, `ja!` returns `Jana jagoda guava` first and the `Ja!` brand products second and third. The 20k seed got this right. Fix, checked in SQL on the 50k seed: rank whole-word matches before prefix-only matches. The top 20 for `ja` then holds 18 `Ja!` products instead of 13 (the seed has 764). Recorded in ADR-007's ranking line; implement and test it in Phase 5.

## Not done, and why

- A: no devices. Needs a scanner page served over HTTPS and an iPhone and Android phone.
- E: needs the operator's Cloudflare account, domain and a phone.

## Fallbacks to keep ready

- iOS scan fails or is slow: make photo upload and typed barcode first-class.
- Short or high-fan-out search slows down: cap the seed at 50k, or add a candidate cap before ranking.
- Infix compound misses show up: add a trigram index.
- `SQLITE_BUSY` appears under load: wrap `WithImmediateTx` in a bounded retry.
