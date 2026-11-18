# Phase 8 — Logging UI

Status: implemented; verification pending (Phases 5–7 are done)
Depends on: 5, 6, 7
Blocks: 9, 10

## Goal

The loop the user actually repeats: scan or search, pick a portion, assign a meal, log it, repeat. Everything must be usable one-handed, offline, and in under ten seconds for a known food.

## Design floor

`../design-parity.md` is the required matrix. Every screen and sheet must match or exceed the mockup and include its loading, empty, error, offline, no-match, permission, and validation states. No simplified substitute for a designed component. Any intentional improvement updates the mockup in the same change.

## Screen inventory

| Surface | Type | Purpose |
|---|---|---|
| Today | route | Summary, recents, meals, entries |
| Scan | route | Camera, typed barcode, photo upload |
| Product | bottom sheet | Food details, portion, meal, add |
| Search | bottom sheet | Recents, favorites, saved meals, results, quick add |
| Quick add | bottom sheet | Name + kcal for unscannable meals |
| Entry edit | bottom sheet | Amount, meal, note, delete |
| Manual food | bottom sheet | Label entry and correction |

## Today

Order on the page:

1. Day navigation: previous, date label, next. "Today" when current.
2. Summary card: kcal left, eaten, goal, meter with 10% ticks, macro bars when targets are set.
3. Actions: Scan a barcode (primary), Search by name (secondary).
4. Recent strip: up to three recent foods, each a one-tap re-log, plus "Copy yesterday".
5. Meal sections: Breakfast, Lunch, Dinner, Snacks. Each shows its kcal total, an add button, and its entries.
6. Empty state when the day has no entries.

Rules:

- kcal left is `goal - eaten`, displayed as an absolute value with "left" or "over". Over-goal uses the red token, not color alone.
- The meter caps at 100%; over-goal switches the fill to red and shows "over" in text.
- Macros show known totals; if any entry is missing a macro, show `—` with a small note, not a false zero.
- Recent foods are the last distinct foods logged, excluding the current meal? No: include all, but tapping adds to the default meal.
- Copy yesterday copies every live entry from yesterday into today with new IDs, preserving meal and portion. Show "Copied N entries" with Undo. If today already has entries, still copy; the undo makes it safe.
- One-tap re-log uses the last portion and unit remembered for that food. If none, use 100 g or the serving size. It adds to the default meal and shows Undo.
- Entry row: name, brand and amount, kcal. Tap opens edit. A long-press or swipe is not required; the edit sheet has Delete.

Default meal by local time:

- Before 10:30 → breakfast.
- 10:30–15:00 → lunch.
- 15:00–21:00 → dinner.
- After 21:00 → snack.

The user can change the meal in every sheet.

## Scan

- Full-bleed camera view with a dashed reticle and a status line.
- Formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128.
- Native `BarcodeDetector` when it supports `ean_13`; otherwise dynamically import the `barcode-detector` ponyfill backed by `zxing-wasm`.
- Self-host the WASM under `/wasm/`; configure the module override. Never load it from a CDN.
- Throttle detection to about 10 fps with `requestVideoFrameCallback` where available, otherwise `requestAnimationFrame`.
- On success: stop the loop, `navigator.vibrate(40)`, play a short WebAudio beep if the user has interacted, announce "Barcode found" through a polite live region, then open the product sheet.
- A "Scan feedback" setting toggles sound and haptics. Default both on.
- Deduplicate the same code within 2.5 s.
- Torch: show only when `getCapabilities().torch` is true; toggle with `applyConstraints`.
- Camera lifecycle: stop all tracks when leaving the route or opening a sheet. Restart on return. Never leave the camera running behind a modal.
- Errors:
  - Permission denied: "Camera access is blocked. Allow it in your browser settings, or type the barcode."
  - No camera: "No camera found. Type the barcode instead."
  - Camera busy: "The camera is in use by another app."
  - Insecure context: "Camera needs HTTPS. Type the barcode instead."
- Fallbacks: Type barcode (numeric sheet), Search by name, Upload a photo (decode a still image), Add manually.
- A file input accepts `image/*`, creates an ImageBitmap, and runs the same detector once.
- The camera area never renders a dead black rectangle: the error state replaces it with a readable panel and actions.

## Barcode resolution flow

1. Normalize digits.
2. Look up `foods` in Dexie by barcode.
3. If found, open the product sheet with the remembered portion.
4. If missing and online, call `GET /foods/barcode/{code}` with a loading state.
5. If a loggable food returns, cache it in Dexie and open the sheet.
6. If the server returns a catalog hit, cache it in Dexie and open the product sheet; no manual step.
7. If 404, open the manual sheet with the barcode prefilled.
8. If offline or upstream fails, open the manual sheet with the barcode prefilled and explain that the product is not cached.

## Product sheet

Header: image, name, brand, package size, barcode, Nutri-Score badge.

Nutrition: per-100 g label with energy, fat, saturates, carbohydrate, sugars, protein, salt. Missing values show `—`. The total line updates live.

Portion control:

- Unit toggle: g, ml (only for liquids), portion (only when a serving weight exists), piece (only when a piece weight exists).
- Amount stepper with +/- and a numeric input. Decimal comma accepted.
- Presets: 1 portion, 2 portions, 100 g, whole pack if the package size is numeric.
- The remembered unit and amount for this food are prefilled.
- A note shows the normalized grams when the unit is not g: "2 portions · 30 g".
- Quick presets never exceed 5,000 g; validation blocks zero, negative, and absurd values.

Meal selector: four segmented options, default from the time of day.

Primary action: "Add to lunch" (the meal label is in the button). On add:

- Write the entry optimistically to Dexie and the outbox.
- Close the sheet, show "Added to lunch" with Undo.
- Stay on the route the user came from; if that was Scan, return to Today or stay on Scan? Return to Today. The scan tab can be reopened; this confirms the log.
- If sync is offline, still add; the banner shows pending.

Secondary links:

- "Edit nutrition" opens the manual sheet prefilled. Saving updates the food (source user) and the current sheet values. Existing entries keep their snapshots.
- "View on Open Food Facts" opens the source page in a new tab.
- A small "from Open Food Facts, may be stale" note for source `off`, with "Checked 3 Nov".
- A "custom food" note for source `user`.
- If the product is `not_loggable` (no kcal), replace the Add button with "Add the label manually" and "Quick add calories". Never show a zero-calorie Add.

## Search sheet

Header: "Add to lunch", date, close.

Search field: autofocus, 250 ms debounce, abort stale requests.

Sections, in order:

1. Recent: last 5 distinct foods, with portion and kcal. Tap opens the product sheet; the plus logs the remembered portion immediately.
2. Favorites: pinned, same interaction.
3. Saved meals: name, item count, kcal. Tap logs all items as separate entries with Undo.
4. Results: local MiniSearch results render immediately; server results replace them when they arrive. Every result has kcal and opens the product sheet directly.
5. Quick add: a persistent outline button at the bottom.

States:

- Empty query: recents, favorites, saved meals.
- No results: "No match. Try the barcode or add it manually." with both actions.
- Offline: local results plus "Search is offline. Showing saved foods."
- Rate limited or upstream down: keep local results, show a small inline note.

## Quick add

For a restaurant meal, a homemade plate, or anything without a label.

Fields:

- Meal (default by time).
- Name, optional; placeholder "Lunch with colleagues".
- Calories, required.
- Protein, carbs, fat, optional.
- Note, optional.

Creates an entry with no food ID and a synthetic 100 g basis: `amount=1`, `unit=serving`, `grams=100`, per-100 values equal to the totals. The entry shows "1 portion" and the kcal total; it never displays a per-100 label. This keeps one nutrition code path.

Validation: kcal 1–5,000 per entry; macros 0–500.

## Entry edit

- Amount and unit edit using the entry's snapshot.
- Meal segmented.
- Note.
- Delete with a 5 s Undo toast. If the delete has not synced, Undo cancels the op; if it has, Undo creates a new entry with a new ID.
- Shows the food source and a link to the food details.

## Saved meals, favorites, and custom foods

These are promised by Search and must be creatable, editable, and removable.

- **Save this meal**: the meal section menu offers "Save as meal". It snapshots the live entries into a named saved meal, editable before saving.
- **Saved meal row**: tap logs all items as separate entries with one Undo; the edit sheet renames it, changes items, or deletes it.
- **Favorite**: a star action on the product sheet and on search result rows. Favorites pin above search results. Settings lists them with an unfavorite action.
- **Custom foods**: Settings lists user foods with name, barcode, last used, and edit/delete. Deleting a custom food never deletes historical entries; those keep their snapshots.
- **No-match path**: after saving a custom food, show an "Add to Open Food Facts" external link and explain that the local correction wins on this device.

## Manual food

Used for a missing barcode, a correction, or a homemade staple.

Fields:

- Name, required.
- Brand, optional.
- Barcode, prefilled and editable when launched from a miss; read-only when correcting a found food.
- Name and brand are prefilled from the catalog when a search result is selected, and from the barcode only on a true miss.
- Serving size in grams, optional; enables the portion unit.
- Per-100 g: kcal required; protein, carbs, fat required; sugar, saturates, fiber, salt under "More nutrients".
- A note explains that kcal is mandatory and that missing values stay blank, not zero.
- Save creates/updates a `source='user'` food and returns to the product sheet (or logs immediately if launched from quick add).

## Remembered preferences

Local-only, never synced:

- `foodPrefs`: `foodId`, `unit`, `amount`, `updatedAt`.
- Default meal by time.
- Last selected history range.
- Last theme.

Use Dexie for `foodPrefs`; it survives reloads and is cheap to rebuild.

## Toasts and feedback

- Add: "Added to lunch" + Undo.
- Copy: "Copied 4 entries" + Undo.
- Delete: "Entry deleted" + Undo.
- Sync: "Synced" is quiet; errors are persistent until dismissed or resolved.
- Haptics on scan success and add.
- No modal confirmation for ordinary logging; confirmation only for destructive bulk actions like "Delete all data".

## Accessibility

- Scanner has non-camera alternatives and does not trap focus.
- A detection is announced through a polite live region, with an optional sound and haptic cue.
- All sheets are Radix dialogs with titles, focus trap, and Escape.
- Numeric inputs have inputmode and labels; errors are announced.
- The amount stepper has accessible names ("Decrease amount").
- Toasts are `role="status"` and do not steal focus.
- Color is never the only signal for over-goal or Nutri-Score; text is present.

## Tests

Component and hook:

- Default meal mapping at boundary times.
- Portion math for g, ml, portion, and piece.
- Missing nutrients render `—`.
- One-tap re-log uses the remembered portion.
- Copy yesterday clones entries with new IDs.
- Undo add and undo delete.
- Quick add creates the synthetic entry correctly.
- No-match opens the manual sheet with the barcode.
- Offline barcode miss does not call the network.

Scanner:

- Native detector path with a mocked `BarcodeDetector`.
- Ponyfill path with a mocked module.
- Permissions denied, camera busy, insecure context.
- Duplicate code suppression.
- Torch capability gating.
- Still-image decode.
- Camera stops on route change and sheet open.

E2E:

- Mock camera with a fake video or a mocked detector: scan → product → add → Today total updates.
- Offline reload after adding: entry persists.
- Search → no match → manual food → add.
- Quick add → history shows the day.
- Save a meal from a day, log it again, edit it, delete it.
- Favorite a food, verify it pins in search, unfavorite it.
- Create, edit, and delete a custom food; historical entries survive.
- A `not_loggable` product offers manual and quick add, not a zero-calorie Add.
- A catalog hit logs without an OFF call and without a manual step.
- Search results always have kcal; no identity-only badge.
- Keyboard-only add flow.
- Scanner detection announces and respects the feedback toggle.
- Visual regression baselines for every surface/state at 400 px, light and dark, match the approved mockups.

## Acceptance

- A known food logs in under 10 seconds from tapping Scan, including the sheet.
- A cached food logs offline.
- A missing product never dead-ends; the manual sheet opens with the barcode.
- One-tap re-log and copy yesterday work without opening the product sheet.
- The sheet is usable one-handed at 400 px and with the iOS keyboard open.
- No console errors; no layout shift when the keyboard opens.
- All new surfaces pass axe.

## Out of scope

Recipes, OCR, barcode contribution back to OFF, multi-item cart scanning, and voice input.
