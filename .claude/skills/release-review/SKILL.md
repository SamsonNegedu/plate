---
name: release-review
description: Use before marking a phase complete, opening a PR, or merging. Reviews the diff against the phase plan, CLAUDE.md, the sync/security invariants, tests, generated files, and the progress tracker.
---

# Release review

Review real changes only. Do not invent findings or audit untouched code.

## Inputs

- The current diff or the files named by the user.
- `.claude/tasks/README.md` and the current phase file.
- `.claude/tasks/00-architecture.md`.
- `CLAUDE.md`.
- The relevant guardrail skills.

## Passes

### 1. Plan alignment

- Does the diff implement only the current phase?
- Are later-phase features, speculative abstractions, or unrequested dependencies present?
- Are all acceptance checklist items actually met?
- Is the phase status and README tracker updated?
- If a locked decision changed, was the architecture updated first?

### 2. Correctness

- Nutrition math: per-100 vs per-serving, missing vs zero, grams normalization.
- Dates: local date assignment, day start, DST, invalid input.
- Barcode: normalization, unknown path, no-match fallback.
- Search: FTS input bound, prefix, fallback, German fixtures.
- Entries: idempotent PUT, tombstone, undo.
- Export/import: validation before write, round-trip.

### 3. Data integrity

- No hard delete of a syncable row.
- Every mutation has an op ID and an outbox path.
- `server_seq` assigned in the same transaction.
- No network call inside a transaction.
- Historical snapshots untouched.
- Randomized convergence tests pass.

### 4. Security

- Auth on every non-public route.
- Session cookie flags.
- Origin/CSRF on mutations.
- No user-controlled URL fetched.
- Body and batch limits.
- No secret or token in logs.
- CSP not loosened.
- New dependency justified and audited.

### 5. Tests and generated files

- New behavior has a test at the right layer.
- No live network, no sleeps, no shared database.
- Offline path tested for new data surfaces.
- `go test -race ./...`, `pnpm test`, and the relevant E2E pass.
- sqlc, OpenAPI TypeScript, and lockfiles are regenerated and not hand-edited.
- `make verify` passes.

### 6. UI and accessibility

- Tokens only; light and dark.
- The design parity matrix is satisfied; no downgrade vs the mockups in type, spacing, hierarchy, contrast, states, or motion.
- 400 px and 320 px checked.
- Keyboard path and focus.
- Chart table and goal line.
- Copy is sentence case, actionable, no em dashes.
- Scanner stops on navigation.

### 7. Operations

- Migration is additive or expand/contract.
- Pre-migration snapshot exists.
- New config variable documented in `.env.example`.
- Admin actions use one-shot startup flags, not a new CLI.
- Maintenance job remains non-blocking and idempotent.
- New data source attributed.
- Runbook updated for a new operational step.

### 8. Coverage and freshness

- A change to food lookup or search updates `testdata/barcodes-de.csv` or reports the current per-chain identity and nutrition hit rates.
- The catalog seed version and ODbL attribution are recorded, and the catalog is excluded from the logical export and client sync.
- A stale food revalidates without blocking and never overwrites a user correction.
- A product with no kcal is not loggable and offers manual/quick add.
- Misses still land in the manual flow with the barcode prefilled.

## Report format

Group by severity:

- **P1** data loss, auth bypass, sync corruption, crash on launch.
- **P2** wrong math, scan failure on a supported device, offline failure, unreadable chart.
- **P3** polish, copy, non-blocking errors.

Each finding: `file:line`, the defect, the concrete failure scenario, and the rule it violates. If nothing violates the standards, say so plainly.

Do not apply fixes unless asked. This is a review, not a rewrite.

## Verdict

End with one of:

- **Ship** — no P1/P2, checklist complete.
- **Ship with P3s** — list them and their follow-up.
- **Block** — list the P1/P2s that must be fixed.

A phase is not complete because the code compiles. It is complete when the acceptance checklist and `make verify` both pass.
