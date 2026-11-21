# Phase 13 — Shared food corrections and nutrition-table OCR

Status: built on main, not yet through review (2026-11-21). Open items are listed under "What is left" at the end.
Depends on: Phase 11 (QA baseline). Can run beside Phase 12.
Decisions: ADR-020 (shared corrections), ADR-021 (on-device OCR). Edit those first if anything below changes them.

## Goal

When a known product has wrong or missing nutrition (example: REWE Beste Wahl Räucherlachs, barcode 4337256560191, where OFF holds 399 kcal per 100 g and the label says 192), one person fixes it once and everyone gets the fix. The fix is stored in the OFF shape so it can be pushed upstream later. A person can fix it by photographing the label.

## Out of scope

Pushing to OFF (no OFF account, no network write). A client-side moderation UI. Corrections for foods without a barcode (they stay per-account custom foods).

## Slices (in order; each ships on its own)

### 13.0 — OCR spike (gate for 13.4)
- Corpus: 25 nutrition-table photos already pulled from OFF's public images (top-scanned products, `manifest.json` holds each barcode and OFF's values), plus your own phone photos as they come, since OFF images are cleaner than kitchen photos. OFF values are not ground truth (the salmon record is wrong), so each expected value is read off the photo by eye before it counts. Images are CC BY-SA and large: keep them out of git, in a gitignored fixture folder, and commit only the expected-values JSON. Original brief: 25 real label photos (German retail, mixed layouts: one column, per 100 g plus per portion, kJ/kcal on two lines, rotated, glare). `IMG_8943.DNG` (salmon) is fixture 1; expected 801 kJ, 192 kcal, fat 12, saturates 1.9, carbs 0, sugars 0, fibre 0, protein 21, salt 2.8.
- Try Tesseract.js (WASM, `deu+eng`) against the corpus. Measure per-field exact-match rate and time on a mid-range phone.
- Pass: at least 90% of fields exact, 100% of fields either exact or flagged for review (never confidently wrong), under 6 s on the phone. Fail: stop and decide between another engine or a manual-assist form (photo shown next to typed fields).
- Dependency note for the phase file: `tesseract.js` and `deu`/`eng` traineddata, self-hosted, loaded on first use and cached by the service worker, not precached. No CDN.

**Spike result (2026-11-21, Tesseract 5.5.3, `deu+eng`, same engine and models as tesseract.js, desktop timing about 3.5 s per image):**
- Gate not yet passed, and the corpus needs fixing. Raw OFF images scored 24 of 197 fields exact (12%) with a naive parser: most images are whole-pack shots, other languages (Hungarian, Cyrillic, French) or tiny text, so OCR returned almost nothing. That measures the corpus, not the engine.
- On a properly upright, cropped table the engine is good: the salmon label read every field correctly except saturates, which came back as `1,99` for `1,9 g`.
- **Systematic error found:** the unit `g` is read as a digit `9`. It explains 8 of the 29 wrong values (`1,59` for `1,5 g`, `3,49` for `3,4 g`, `0,89` for `0,8 g`). The parser must never trust a trailing `9`: it reads the value and unit as separate tokens (word boxes from the TSV output), and when a g-row ends in `9` it flags the field and shows both readings. Energy against 4P + 4C + 9F picks the right reading for the macros; saturates, sugars and salt always go to the person to confirm.
- A second error class: kJ glyph `kJ` read as `k)`; unit tokens need fuzzy matching (`kj`, `k)`, `kJ`).
- Orientation matters: a DNG/JPEG needs its EXIF rotation applied before OCR (the crop step does this in the app).
- **Prototype (steps 1 to 3, Python plus ImageMagick plus Tesseract word boxes; throwaway, not in the repo):** greyscale, upscale to 1,600 px, contrast stretch, two threshold variants and two page-segmentation modes; word-box rows with column choice by the "100 g" header; value and unit read apart; candidate readings for a trailing `9`; a solver that picks the combination passing the most label checks; hard caps (g fields at most 100, kcal at most 900).
  - Salmon crop: 9 of 9 fields correct, including `1,9 g`, which plain OCR got wrong. Saturates and salt are shown for confirmation because more than one reading was possible.
  - OFF corpus: still 28 of 197 exact, 53 wrong (21 of them not flagged). I wrote that the corpus was mostly whole-pack photos; that was wrong. Looking at the images, they are mostly real table close-ups, and hard ones: several columns (100 g, portion, % of reference intake), the unit in its own column, stacked "kJ / kcal" cells, three or more languages on one label, curved packs and condensed or very small type. So they are a fair hard test, and the prototype is genuinely weak on them. The failures it did show are real rule gaps: `1,4 g` read as `149` (comma lost and unit read as 9), and values from a neighbouring column (portion or %RI).
  - Not done yet: a per-field unflagged-wrong rate on genuine crops, which is the number the gate needs.
- **Parser v2 (prototype):** row clustering by position, the 100 g column chosen by header x position, value and unit read apart, wrapped labels, kJ/kcal pairing by the 4.184 ratio, French/Spanish/Italian/Dutch/Polish keywords, six preprocessing passes (grey, threshold, inverted, red, green and blue channels) with a vote: a value is unflagged only if two passes agree and the checks pass. On the 25 hard OFF labels: 50 of 197 fields exact (25%), 7 confidently wrong, 46 wrong but flagged, 94 not read. Down from 21 confident errors, but nowhere near the bar. Salmon stays 9 of 9. About 25 s per image on a desktop with six passes, too slow for a phone as built.
  - Reading: Tesseract fails to read about half of these labels at all (coloured backgrounds, condensed type, many languages). The parser cannot fix text the engine never sees.
  - Decision input: test a stronger engine (PaddleOCR PP-OCR models through ONNX, or RapidOCR) on the same labels before investing more in Tesseract tuning.
- **Engine test (2026-11-21): RapidOCR, which runs the PP-OCRv4 detection and recognition models through ONNX Runtime (the same models PaddleOCR uses; PaddleOCR proper needs the heavy Paddle runtime, so it was not run separately).** Same parser v2, a single pass, no preprocessing variants, on the same 25 labels:

  | | Tesseract, six passes | PP-OCRv4 via ONNX, one pass |
  |---|---|---|
  | Fields exact | 50 of 197 (25%) | 117 of 197 (59%) |
  | Not read | 94 | 53 |
  | Wrong, not flagged | 7 | 26 (not yet reviewed against the photos; some are OFF's own rounding or errors) |
  | Time per image (desktop CPU) | about 25 s | median 1.0 s, max 1.9 s |
  | Salmon crop | 9 of 9 | 8 of 8 (kJ not needed) |

  - Model files: detection 4.7 MB, recognition 10.9 MB, orientation classifier 0.6 MB, 16.2 MB in total, plus the ONNX Runtime WASM for the browser. Browser size, phone speed and memory are not measured yet.
  - The wrong-but-unflagged count is higher because a single pass has no voting. Next: add a second pass (inverted) and the same two-pass-agreement rule, review the unflagged errors against the photos, then re-score.
  - Still to measure before the gate: in-browser build size, time and peak memory on a real iPhone and an Android phone, and the 100 German-only labels.
- **Three passes plus agreement rule, PP-OCRv4:** 25 hard labels: 125 of 197 exact (63%), 21 wrong without a flag, 41 not read, about 3.5 s per image on a desktop. Reviewed against the photos: 6 of the 21 are OFF's own errors (OCR read the label right), 1 label is a US "Nutrition Facts" panel whose per-serving values were taken as per-100 g (breaks the never-per-serving rule; must be fixed), the rest include real misreads on long wrapped multi-language rows.
- **94 German-only OFF labels (newest uploads):** 705 fields, 437 exact (62%), 32 wrong but flagged, 95 wrong without a flag (13.5%), 141 not read (20%), median 3.0 s per image. **The gate is not passed** (bar: 90% exact and no confident misses).
  - Error classes seen: a lost decimal point (`1,5` read as `15`, `0,6` as `60`, `2,0` as `20`, about 15 fields); sat and sugar swapped; a prepared-product column or a half-portion column read instead of 100 g (ice cream, pasta); and many small differences against OFF values that OFF itself computed from servings (83.13 kcal, 3.488 g), which are OFF noise, not misreads.
  - Planned fixes: reject or convert a per-serving or "Nutrition Facts" panel; add a divide-by-ten candidate for whole numbers and let the energy and sat/sugar checks pick; match against label rounding, not exact OFF decimals; skip "zubereitet"/"prepared"/"as prepared" columns; then re-score.
- Next: replace the corpus with crops only (keep OFF images that are real table close-ups, add phone photos taken through the crop step), re-score with the word-box parser, then judge the 90% and no-confident-miss bar.

### 13.1 — Shared product facts (server)
- Migration: `product_facts` (barcode PK; OFF-named nutrient columns, nullable; `product_name`, `brands`, `quantity`, `serving_size`, `status` pending|accepted|disputed|upstream_confirmed, `accepted_revision`, timestamps) and `product_fact_revisions` (append-only: revision id UUIDv7, barcode, values, `source` manual|ocr, `contributor` opaque id, `app_version`, `label_image_key` nullable, `submitted_at`). No `user_id` on facts; the contributor id is a keyed hash of the account id.
- Plausibility validator in Go (`internal/food/plausibility.go`), the single rule set: energy vs macros within 15%, kJ and kcal agree within 5%, saturates ≤ fat, sugars ≤ carbs, macros sum ≤ 100 g, salt and sodium agree, each nutrient inside a hard range. Also run on OFF and catalog rows as a soft flag.
- Acceptance rule (ADR-020, updated 2026-11-21): a revision that passes the plausibility checks goes live for every account at once and replaces what was served, typed or scanned, with or without photos. One that fails a check is stored, named, and visible only to its author. No quorum: with open signup and few accounts it would rarely form and two throwaway accounts pass it. Photos, when sent, must decode as an image of sane size; the server never trusts a client flag.
- Dispute rule: two disputes from accounts other than the contributor revert to the previous revision, or to what OFF and the catalog say. Caps: 50 submissions a day and 500 in total per account.
- Lookup order becomes: own live food → accepted fact → catalog → OFF → manual. OFF refresh and `PLATE_CATALOG_REIMPORT` never overwrite an accepted fact. A refresh within 2% of the fact marks it `upstream_confirmed`.
- Fan-out: accepting a fact rewrites each account's server-managed `foods` row for the barcode (sources `off`, `catalog`) through `change_log` in one transaction. Entries are untouched. A person's own custom food on that barcode is untouched.
- Endpoints (Huma): `PUT /foods/{barcode}/correction`, `POST /foods/{barcode}/dispute`, `GET /foods/{barcode}/correction` (status and history for the contributor). Per-account caps (50 submissions a day, 500 total) and a global cap.
- Tests: isolation (a value that fails the checks never leaks to another account), tolerance edge cases, revert, reimport and refresh do not clobber, fan-out is idempotent, deleting an account keeps its contributions detached, migrations up/down.

### 13.1b — Provenance and OFF compatibility (part of 13.1)
- **Provenance is explicit.** `foods.source` gains `community` (a row served from `product_facts`), next to `off`, `bls`, `user`, `catalog`. Every fact keeps `origin`: `off_correction` (OFF had the product, values replaced), `off_missing_fields` (OFF had it, fields filled in) or `new_product` (OFF did not have it). The UI footer and the export read it, so "from OFF" is never shown for community data.
- **Fields OFF needs for a push, all stored per revision:** `code`; `lang` (label language, e.g. `de`); `countries` (default `en:germany`); `product_name`; `brands`; `quantity`; `serving_size`; `ingredients_text` (optional); `nutrition_data_per` (`100g` or `serving`); nutrient values with unit and modifier (`<`, `>`, `~`, none), so "<0.5 g" is not flattened to a number; `energy-kj_100g` and `energy-kcal_100g` both; salt and sodium both when printed; the label photo as the nutrition-table image; an optional front photo. Values are stored as printed on the label, per 100 g when the label has that column.
- **Front photo.** Optional. OFF needs one to create a product, so a new-product revision without it is stored as not push-ready; `make off-export` lists it separately. It goes through the same crop, EXIF strip and size cap as the label photo and is stored on the revision.
- **Not captured on purpose:** anything about the person (name, device, location). The contributor id is opaque and is not exported.
- **Export check.** A test builds an OFF write payload from a fact (`product_jqm2.pl` field names) and validates it against OFF's field list, so a missing required field fails CI, not the day we push.
- **Known gaps to settle before any push (a later ADR):** OFF wants the nutrition photo as a lightly cropped table image, which the crop gives. OFF's licence for contributed photos (CC BY-SA) must match what the person agreed to at submit.

### 13.2 — Edit nutrition becomes "Correct this product" (client)
- For a product with a barcode, Edit nutrition submits a correction instead of only a private row. The sheet says plainly: "A label scan updates the product for everyone. Typed values apply to you until a second person confirms them."
- Status chip on the food sheet: Pending (yours), Community-corrected, Confirmed by Open Food Facts.
- The person's own value shows immediately (offline-first); the submission is an outbox op with an `op_id`.
- Footer text keeps source honesty: "From Open Food Facts, corrected by the community. Checked 21 Nov."
- Design: match the existing sheet tokens; update `mockups.html` and `design-parity.md` first for the new chip and copy.

### 13.2b — Not found: add this product
- Today a barcode miss opens the manual form with the barcode filled in. It becomes an "Add this product" screen with two ways in: **Scan the label** (13.4) or **Type it in**. Name, brand and quantity are asked for, since no source has them. A front-of-pack photo is required for a new product (see 13.1b), taken in the same flow after the label photo.
- Submission is the same correction call as 13.2, for a barcode with no fact yet. A submission that passes the checks goes live for everyone at once, typed or scanned.
- **Rescan finds it.** Saving writes the author's own `foods` row locally (so offline rescans and reloads work), and the server clears its 24-hour "not found" marker for that barcode and the client clears its `foodMisses` entry. Another account scanning the same barcode after acceptance resolves through the lookup order to the fact, with no OFF call.
- The "not loggable" outcome (a product exists but has no usable calories) uses the same screen, with the existing name and brand prefilled.
- Offline: the screen works, the submission waits in the outbox, the author can log the food meanwhile.
- Tests: miss then add then rescan hits the fact (online and offline); a second account's rescan after an instant acceptance; an add that fails the checks is invisible to a second account; miss markers cleared; a barcode added by two accounts at once converges to one fact with two revisions.

### 13.3 — Plausibility warning
- The shared TS mirror of the validator (generated fixtures keep Go and TS in lockstep) shows "These values look unusual. Check the label." on a food sheet when a check fails, with a one-tap Correct this product. Salmon at 43.8 g protein per 100 g must trip the category cap; add a small per-category cap table (fish, meat, dairy, bread, cheese, oils, sweets) and keep it data, not code.
- Never blocks logging. Never hides a value.

### 13.4 — Nutrition-table OCR (after the 13.0 gate)
- Capture: camera or file, then a crop step around the table. Photo stays on the device unless the person opts to attach it to the correction; an attached photo is the cropped region only, EXIF stripped, size-capped (the sample photo shows a hand and a kitchen; never upload the full frame).
- Parser (`web/src/food/nutritionOcr/`, pure TS, no DOM): find the table by keywords (DE and EN: Energie/Energy, Fett/Fat, davon gesättigte Fettsäuren/of which saturates, Kohlenhydrate, davon Zucker, Ballaststoffe/Fibre, Eiweiß/Protein, Salz/Natrium); pick the per-100 g column (header "pro 100 g"/"per 100 g"); handle kJ and kcal pairs on one or two lines, decimal commas, `g`, `mg`, `µg`; fix OCR confusions only inside a numeric context (O→0, l→1); a per-portion-only table converts only with a known serving weight, otherwise the value stays missing; missing rows stay `NULL`.
- Confirm screen: the photo beside the fields, each field with a confidence mark; fields that failed a plausibility check or read with low confidence are highlighted and must be looked at before Save. Save goes through 13.2.
- Tests: the 25-label corpus as fixtures (expected values in JSON), property tests for number parsing, the salmon fixture end to end. Accessibility: the confirm form is keyboard-only usable and every highlight has text, not just colour.
- Runs offline once the engine is cached; if not cached and offline, fall back to the manual form.

### 13.5 — OFF-compatible export
- `make off-export` writes accepted facts as OFF-named JSON/CSV with provenance (revision, source, contributor id, label image key) to a file. No network. This is the data a later push ADR will use; it also lets the operator hand it to OFF manually.

## Docs and attribution (same change as the behaviour)
`docs/food-and-search.md` (lookup order, corrections), `docs/data-model.md` (two tables, the shared-layer rule), `docs/accounts.md` (contributions survive deletion, caps), `docs/api.md` (generated), `docs/configuration.md` if a setting is added, `docs/attribution.md` (community contributions are offered under the same ODbL terms as the database; say so in the UI submit text). `internal/docscheck` must pass.

## Risks

| Risk | Mitigation |
|---|---|
| Vandalism with no administrator | Plausibility checks, caps, a two-account dispute that reverts, append-only history. Accepted risk: a plausible wrong value stays up until disputed |
| Fake photo plus fake values go live at once | Plausibility checks, per-account caps, dispute revert. A photo is not proof; the server does not run OCR itself, so a mismatch between photo and values cannot be detected. Accepted residual risk, revisit if abused |
| Two colluding accounts (manual path) | Open signup proof of work and per-account caps raise the cost; revisions are kept so a bad one can be reverted by hand in the database. Accepted residual risk, revisit if it happens |
| Correction wrong but plausible | The label photo evidence and the OCR confirm step; dispute path |
| OCR confidently wrong | 13.0 gate requires no confident misses; confirm screen; sanity checks |
| Label photo leaks private surroundings | Crop-only upload, EXIF stripped, opt-in |
| Fan-out slows accept | One transaction per barcode, bounded by the number of accounts holding that barcode |
| Licence mismatch | ODbL share-alike stated at submit; legal check before any push upstream |

## Acceptance
- A correction of the salmon product, typed or scanned, shows 192 kcal for a second account straight away, and the first account's old entries still show their original snapshot.
- A correction that fails a plausibility check stays private to its author and says which check failed.
- Scanning an unknown barcode, adding it by label scan, and rescanning it finds the food, for the author and for any other account.
- Nothing pending ever appears to another account.
- A catalog reimport and an OFF refresh leave an accepted fact in place.
- OCR on the salmon photo yields the expected values with no manual typing, and a deliberately blurred photo yields flagged or missing fields, never confident wrong ones.
- `make verify` passes; 400 px, keyboard-only, reduced motion, light and dark; design parity updated.

## Built (2026-11-21)

- **Server:** migration `00016` (`product_fact_revisions`, `product_facts`, `product_fact_disputes`, `foods.community_rev`), `internal/food/facts.go` and `plausibility.go`, the three endpoints (`PUT /foods/barcode/{code}/correction`, `GET .../fact`, `POST .../dispute`), the new lookup order, the OFF refresh guard, catalog search overlay, `make off-export` (`tools/offexport`). Tests cover the rules, isolation between accounts, idempotent retries, caps, photos, revert, and entries keeping their snapshots.
- **Provenance** is the nullable `foods.community_rev` column, not a new `source` value: SQLite cannot change a CHECK constraint without rebuilding `foods` and its FTS triggers, so the additive column is the safer route. The API exposes it as `community`.
- **Client:** label-style capture table (`NutrientRow`), "Correct this product" and "Add this product" through `food/corrections.ts` (online it goes live at once; offline a private copy is saved and the correction waits in a device-only `corrections` table), the not-found sheet, the community note and the unusual-values warning on the product sheet, the dose and manual-food forms laid out in two columns.
- **Category warning:** `tools/catalog` writes `category_stats` (5th, 50th and 95th percentile of kcal, fat, protein, carbohydrate and salt for every OFF category with 30 or more German products) and gives each product its most specific category. The importer tolerates a seed without ranges, live OFF fetches ask for `categories_tags`, and `web/src/lib/categoryCheck.ts` shows the unusual-values note when two or more nutrients are well outside the range and one is energy, fat or protein. Ranges reach products only after the seed is rebuilt with `make catalog`.
- **Label reader:** `food/ocr/` (parser, engine, scan). PP-OCRv4 detector and recognizer through ONNX Runtime WASM, written without OpenCV (the off-the-shelf wrapper needs OpenCV.js). Files are in `public/ocr/`, generated by `scripts/copy-wasm.mjs`, served same-origin, cached by the service worker on first use and kept out of the precache.

## Measured in a real browser (headless Chromium on a desktop, one thread; not a phone)

| | |
|---|---|
| Files the reader downloads once | 18.2 MB on the wire (detector 4.4, recognizer 10.0, runtime WASM 3.8, gzipped at build and sent with Content-Encoding by the Go server); 30.4 MB unpacked |
| JS added to the app | about 62 KB, loaded only when someone scans a label (reader 11 KB, ONNX Runtime loader 52 KB) |
| Start-up of the models | about 0.7 s |
| Reading one photo | median 1.9 s, 1 to 5 s |
| JS heap while reading | 40 to 57 MB (the models live in the runtime's own memory as well) |
| Accuracy, 25 hard OFF labels, one pass | 97 of 197 fields exact (49%), 8 wrong without a flag (2 of those are OFF's own mistakes), 87 not read |

The Python prototype reached 63% with three preprocessing passes and the same parser. The browser reader is weaker because it uses axis-aligned text boxes (no deskew), one pass, and its own detector post-processing. It is good enough as a convenience that fills a form for the person to check, not good enough to save unseen.

## What is left

- Phone measurements: speed, memory and the 30 MB download on a real iPhone and an Android phone. Nothing here has run on a phone yet.
- Reader accuracy: deskew, a crop step (the photo is read whole today), and a second preprocessing pass with an agreement rule.
- Playwright flows and visual baselines for the new sheets (the design-parity matrix and `mockups.html` are updated).
- A catalog rebuild from the OFF dump: `category_stats` is computed by `make catalog`, so the current `data/off-catalog.db` has no ranges and the unusual-values warning stays silent for catalog and live-OFF products until the seed is rebuilt.

## Closed after the first status

- The label photo is cropped to the table rows and sent with a scanned correction (opt-out checkbox), and a front photo can be added (900 px, 230 KB); both are re-encoded in the browser, which drops the photo's metadata. Both are stored on the revision and written by `make off-export`.
- Energy can be typed in kJ (converted as it is typed) and a hint appears while typing when the numbers contradict each other, with the figure they add up to.
- The reader's files are stored gzipped (18.2 MB on the wire), the Go server sends them with `Content-Encoding: gzip` and decompresses for a client that does not accept it. The embedded app is 21 MB; the binary is 41.5 MB.
- `mockups.html` has the not-found and add-this-product sheets; `design-parity.md` lists their states.
