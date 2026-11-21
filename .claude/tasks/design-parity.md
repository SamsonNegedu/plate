# Design parity and state coverage

Status: required at every UI phase. Reference: `../../mockups.html`.

## The floor

The mockups are the minimum. The implementation must match or exceed them in:

- layout, spacing, and visual hierarchy
- type scale, weights, and line lengths
- color tokens and contrast in light and dark
- component behavior and interaction states
- motion and feedback
- accessibility, keyboard, and reduced motion

A deviation is allowed only when it improves the result and the mockup is updated in the same change. No silent downgrades: fewer states, smaller type, weaker hierarchy, reduced contrast, removed motion, or a generic component replacing a designed one.

## Single source of tokens

- During Phase 7, move the token block from `mockups.html` into `web/src/styles/tokens.css`.
- Both the mockup and the app link that file. No duplicated hex values.
- A token change updates both at once.
- Fonts stay Barlow and Barlow Condensed, self-hosted, same weights.

## Icons and type

- Lucide for generic actions, with `strokeWidth` 1.7 and 21 px, matching the mockup stroke.
- Port the mockup glyphs for the plate, barcode, scan, and nutrition-label marks; do not substitute a visually different generic icon.
- No emoji, no mixed icon families, no filled icons where the mockups use strokes.

## State inventory

Every surface gets designed states, not browser defaults.

| Surface | Mockup | Required states |
|---|---|---|
| Today | Today | default, empty day, over goal, missing macros, offline, syncing, sync error |
| Scan | Scan | starting, detecting, permission denied, no camera, camera busy, insecure context, offline, file fallback |
| Product | Product | found, identity missing nutrition if applicable, not loggable, custom, stale, community-corrected, unusual values, offline, add, edit |
| Search | Search | empty query with recents, results, no results, offline, rate limited, upstream error |
| Quick add | Quick add | default, validation error, kJ entry, numbers that do not add up (the same table and hint as Add this product) |
| Entry edit | Entry edit | default, deleted with undo, tombstoned conflict |
| Manual food | Add this product | new food, correction, missing kcal, server error, label read (values filled, doubtful values marked, photo beside them), per-portion label, nothing read, kJ entry, numbers that do not add up, photos for the product |
| Not found | Not found | barcode shown, scan the label (first-use download wording, reading, downloading, failed), type it in, offline |
| History | History | data, no data, one day, over goal, offline, table view, loading |
| Settings | — (Phase 9) | default, dirty, saved, sync paused, conflicts, export, import, delete-all, install |
| Login / onboarding | — | login, wrong password, rate limited, offline start, first run, goal estimate |
| Global | — | offline banner, sync badge, toast, update prompt, quota error, install prompt |

Where a state has no mockup, design it in the same visual language and add it to this matrix before implementation.

## Parity review

Run after Phase 8, after Phase 9, and after Phase 10 on a real phone.

Phase 7 shell check (2026-11-13): `/login`, `/today`, `/history`, `/settings` and `/scan` captured at 320, 400, 560 and 1440 px, light and dark. No horizontal overflow, no page errors. The two-column CTA and scan action rows were stacking only at 400 px; they now stack below 400 px, fixing a 34–45 px overflow at 320 px.

- Capture side-by-side screenshots at 320, 400, 560 px, and desktop, in light and dark.
- Walk every row of the matrix. Mark each state present, missing, or worse than the mockup.
- List deviations with severity. Fix P1/P2; a P3 needs a dated follow-up.
- If the implementation is better, update the mockup in the same change.
- Sign off in the README progress tracker.

## Visual regression

- Playwright screenshots per surface and state at 400 px, light and dark.
- Baselines are approved from the mockups and the parity review.
- A visual diff fails CI.
- Update a baseline only with a design change, in the same commit as the mockup update.

## Review checklist

- [ ] Tokens come from `tokens.css`; no literal colors in components.
- [ ] Every matrix row has a designed state.
- [ ] Type scale and weights match; numerals are tabular.
- [ ] Light and dark both reviewed.
- [ ] 320, 400, 560 px, and desktop reviewed.
- [ ] Icons and stroke weight match.
- [ ] Keyboard, screen reader, and reduced motion paths reviewed.
- [ ] No P1/P2 design regression vs the mockups.
- [ ] Visual regression baselines updated only with a design change.
