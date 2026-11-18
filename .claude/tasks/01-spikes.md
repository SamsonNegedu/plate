# Phase 0 — Spikes and decisions

Status: in progress (B, C, D, F done; A and E are run manually by the user; see docs/spike-results.md)
Depends on: none
Blocks: every phase

## Goal

Retire the four unknowns that can invalidate the architecture before any production code is written. Every spike is throwaway. Nothing from a spike merges into the app without going through the phase that owns it.

## Spike A — Barcode scanning on real devices

This is the highest-risk unknown.

Build a single throwaway page that:

- Requests the rear camera with `getUserMedia`.
- Tries native `BarcodeDetector` for `ean_13, ean_8, upc_a, upc_e, code_128`.
- Falls back to the `barcode-detector` ponyfill backed by `zxing-wasm`.
- Decodes continuously and reports: time to first decode, decode success count, and failures.
- Reports torch capability and toggles it.
- Handles permission denial, camera busy, and missing camera without crashing.
- Offers a file upload path that decodes an image.

Test on:

- iPhone Safari 17+ over HTTPS, installed and in-browser.
- Android Chrome, installed and in-browser.
- Desktop Chrome and Firefox.

Fixtures: a Nutella EAN-13 (`3017620422003`), an EAN-8, a UPC-A, and a Code 128 label. Test in good light, low light, at an angle, and at 20–40 cm.

Pass criteria:

- iOS first decode under 2 s in good light; at least 8 of 10 attempts succeed.
- Android first decode under 1 s.
- No crash on denial or camera-in-use.
- Torch works or is cleanly absent.
- Self-hosted WASM loads under the target CSP.
- The page works after a full offline reload (WASM precached).

If iOS fails: keep the scanner, but make photo upload and typed barcode first-class, and record the limitation in the UI copy and the launch checklist.

## Spike B — German FTS5 search

Create a temporary SQLite database with `modernc.org/sqlite` and:

- 100,000 synthetic product names, including German compounds, umlauts, and brand punctuation.
- 2,000 real OFF names from the German fixture list.
- An FTS5 external-content table with `unicode61 remove_diacritics 2`.
- Trigger maintenance and a `bm25` query.

Measure p95 for: `joghurt`, `Joghurt`, `käse`, `Kase`, `Vollkornbrot`, `vollkorn`, `Müller`, `ja!`, `Gut & Günstig`, `Milbona`, `Hähnchenbrust`, and a two-character query.

Pass criteria:

- p95 under 20 ms server-side.
- Expected product in the top 3 for every fixture query.
- Prefix queries work.
- No FTS syntax error from punctuation in `ja!` or `Gut & Günstig`.
- The literal-search fallback works for queries under three characters.

If compounds miss: add a trigram index or an equivalent normalized column, and record the decision here.

## Spike C — modernc + goose + sqlc + Huma integration

Build a minimal skeleton, not the production layout:

- A goose migration with a table and an FTS5 virtual table.
- A sqlc query file and generated Go.
- A Huma operation on chi with one GET and one POST.
- A `BEGIN IMMEDIATE` write helper.
- A test using a temporary database file.
- A static build with `CGO_ENABLED=0`.

Pass criteria:

- `sqlc generate` parses the goose migrations without a separate schema file.
- FTS5 works through the driver.
- Concurrent writes retry cleanly instead of returning `SQLITE_BUSY`.
- The Huma OpenAPI document includes both operations.
- The binary cross-compiles for darwin/arm64 and linux/amd64.

Record any workaround in this file.

## Spike D — Sync protocol paper test

Before writing the real engine, walk these cases on paper and in a two-tab prototype with a fake server:

1. Create offline, close the tab, reopen, sync.
2. Create on device A and B while both offline, then sync.
3. Edit an entry on A, delete it on B, sync both orders.
4. Push the same batch twice; no duplicate entries.
5. Pull a page, crash, resume from the cursor.
6. A client whose cursor is below the user's `sync_state.min_seq` must full-resync.
7. A validation failure in one op must not block the rest.
8. Two tabs draining at once must not double-apply.

Pass criteria: every case has a defined state transition and a matching test in Phase 6.

## Spike E — Cloudflare Tunnel, Access, and TLS

Deploy the throwaway scanner page behind the intended setup:

- A Cloudflare Tunnel with no inbound ports on the origin.
- A Cloudflare Access application on the hostname, restricted to the operator's email, with a 30-day session.
- Install the PWA on a phone.
- Confirm the camera works, cookies stick, and the service worker updates.
- Record what `/api/*` returns when the Access session expires or is missing: HTML login, 302, or JSON. The client needs a deterministic re-authentication path.
- Confirm `CF-Connecting-IP` and `Cf-Access-Authenticated-User-Email` arrive only through cloudflared.
- Confirm Cloudflare cache rules bypass `/api/*`, `/healthz`, and `/readyz`.

Pass criteria: the page loads over HTTPS on the phone with no certificate warning, the camera permission prompt appears, no origin port is reachable directly, and the Access-expiry behavior is documented.

## Spike F — OFF catalog seed build

Prove we can build a common-products catalog with nutrition from the OFF dump before adding it to the plan.

- Download the OFF dump (JSONL/CSV) and stream it. Record file size, parse time, memory, and whether a Germany-filtered export is available.
- Filter `countries_tags = Germany` and require `kcal_100g`. Normalize with the production rules. Deduplicate by barcode.
- Rank by `scans_n`/`unique_scans_n` when the dump exposes them; otherwise use category and brand quotas.
- Build top 20k and top 50k seeds. Measure: rows, uncompressed/compressed size, import time into the app schema, FTS5 p95 for the German fixtures, and corpus resolution without OFF.
- Check duplicates, non-food rows, empty names, malformed nutrition, and encoding.
- Confirm ODbL attribution and share-alike for the derived seed.
- Decide the default seed size (20k, 50k, or the full German subset) and whether a top-5k client starter pack is worth shipping.

Pass criteria: the 50k seed resolves at least 70% of the 200+ corpus without OFF, builds reproducibly in CI, and fits the disk and time budget. If not, the full German subset is the fallback.

## Deliverables

- [ ] `docs/spike-results.md` with measurements, device details, and go/no-go per spike. B, C, D, F recorded; A and E pending the user's manual runs.
- [ ] Catalog seed size/coverage decision recorded, with the build artifact and ODbL attribution. Size decided (50k); build artifact, real corpus and ODbL check still open.
- [ ] ADR updates in `00-architecture.md` for any changed decision. ADR-007 updated; ADR-015 still needs the 50k default and ranking notes.
- [ ] A short list of fallbacks to implement if a spike later regresses.

## Out of scope

Production UI, auth, the real schema, and any code that ships.

## Exit criteria

All five spikes have a result. Any failed spike has a documented fallback and an owner phase. No phase after this one starts while a High-impact unknown is unresolved.

## Review pause waived

On 2026-11-13 the user waived the Phase 0 review pause and asked for end-to-end implementation. Spikes A and E remain open and manual. Risk carried forward: if iOS scanning fails Spike A, make photo upload and typed barcode first-class (see Spike A fallback).
