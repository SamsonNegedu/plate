---
name: ui-design-system
description: Use when building or reviewing any screen, sheet, component, chart, or copy in Plate. Enforces the mockup tokens, type scale, chart rules, and the anti-template visual direction.
---

# UI design system guardrails

## The floor

The mockups are the minimum, not a starting point to simplify. Match or exceed them in layout, type, spacing, hierarchy, states, motion, and accessibility. A deliberate deviation must improve the result and update the mockup in the same change. Never ship fewer states, smaller type, weaker contrast, or a generic component in place of a designed one.

`../tasks/design-parity.md` is the required screen/state matrix. Every surface gets designed loading, empty, error, offline, and edge states, not browser defaults.

During Phase 7, move the token block out of `mockups.html` into `web/src/styles/tokens.css` and link both. No duplicated hex values.

## Source of truth

`mockups.html` is the approved direction. Port it; do not invent a new one.

## Tokens

Use only these. No new hex values in components.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f4f5ef` | `#12150f` |
| `--surface` | `#ffffff` | `#1a1e17` |
| `--surface-2` | `#e9ecdf` | `#232920` |
| `--ink` | `#171a16` | `#ecefe4` |
| `--ink-2` | `#5a6155` | `#a6ad9d` |
| `--ink-3` | `#8c9385` | `#7c8475` |
| `--line` | `#d6dbcc` | `#2d3329` |
| `--accent` | `#2e6b4a` | `#6cba8c` |
| `--on-accent` | `#ffffff` | `#0e1712` |
| `--red` | `#ae352b` | `#e2796d` |
| `--amber` | `#b0731b` | `#dfa63d` |

Radii: 14 px for cards and sheets, 10 px for controls, 999 px for pills and the meter. Hairlines are 1 px `--line`; meal headers use a 1.5 px `--ink` rule.

## Type

- Barlow for UI and body; Barlow Condensed for large numbers and the wordmark.
- Numbers use tabular figures everywhere.
- Display numbers: clamp(56px, 17vw, 78px), weight 600, line-height 0.82.
- Headings: 26/24/17 px, weight 600. Body 15 px. Meta 12–13 px.
- Sentence case. No all-caps labels, no letter-spaced eyebrows.
- Do not accent a single word in a headline. Do not append arrows to buttons.

## Layout

- Mobile-first, max width 560 px, side gutter 16 px.
- Bottom tab bar; safe-area padding.
- Sheets anchor to the bottom, max height 92dvh, with a grab handle and a sticky footer.
- Meal sections are hairline-separated rows, not cards. Cards are for the summary, panels, and the chart only.
- One bold element per screen. The big remaining-calories number is that element; keep the rest quiet.

## Component rules

- `Sheet`: Radix Dialog, focus trap, Escape, restore focus, no camera behind it.
- `Segmented`: radio semantics, `aria-pressed`, minimum 38 px height.
- `Meter`: 10% ticks, capped fill, red only when over goal, text states "over".
- `EntryRow`: name, meta, kcal; tap opens edit; no swipe-only actions.
- `Toast`: `role="status"`, Undo when destructive, no focus steal.
- `EmptyState`: one sentence and one action, not decoration.
- `Nutri-Score`: letter plus color; never color alone.

## Chart rules

- One y-axis, zero baseline, bars anchored to it.
- 4 px rounded top corners only; 2 px gap; no shadows or gradients.
- Goal line dashed, labeled, with a surface halo.
- Single series. Over-goal uses the status red and is also stated in text.
- Direct-label only today and the goal. No label on every bar.
- Hover and keyboard tooltip; table view is mandatory.
- Text uses ink tokens, never the series color.
- No dual-axis chart, ever.

## Copy

- Plain, active, specific. "Add to lunch", not "Submit".
- Errors say what happened and what to do. No apologies, no vagueness.
- Empty states invite an action.
- No em dashes. No "not X, but Y" constructions. No stock phrases.
- German product names keep their spelling, including umlauts.

## Motion

- One purposeful moment per screen at most. The scan line is the only ambient animation.
- No fade-and-slide on every section.
- Respect `prefers-reduced-motion`; the scan line stops.

## Forbidden

- New colors, gradients, glassmorphism, or heavy shadows.
- Identical rounded cards for every block.
- Emoji as icons or section markers.
- All-caps labels, tracked-out eyebrows, numbered markers that do not encode a sequence.
- A chart with two y-axes or a rainbow palette.
- Placeholder or lorem copy.
- Inline styles for color or spacing.

## Review checklist

- [ ] Tokens only; light and dark both correct.
- [ ] Every state in `design-parity.md` is present and designed.
- [ ] No downgrade vs the mockup: type, spacing, hierarchy, contrast, motion.
- [ ] Visual regression baselines updated only with a design change.
- [ ] Type scale respected; numerals tabular.
- [ ] One primary action per screen.
- [ ] 400 px, 320 px, and desktop widths checked.
- [ ] Keyboard focus visible; reduced motion honored.
- [ ] Chart has a table and a goal line.
- [ ] Copy is sentence case and actionable.
- [ ] No new visual language beyond the mockups.
