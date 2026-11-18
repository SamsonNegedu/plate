---
name: testing
description: Use when adding or changing tests, fixtures, CI checks, or when verifying a phase in Plate. Enforces deterministic tests, the right test layer, fake time and network, and the required coverage for sync, auth, nutrition, and migrations.
---

# Testing guardrails

## Rules

- No test touches the live network. OFF, images, and auth callbacks are always faked.
- No `time.Sleep` in Go or frontend tests. Use a fake clock and deterministic scheduling.
- No shared database. Every Go integration test gets `t.TempDir()` and runs migrations.
- Every Dexie test starts from an empty database; `fake-indexeddb` is reset between tests.
- Test behavior, not implementation details. Do not assert on private state or call counts unless the call is the contract.
- A snapshot test alone is not coverage. It may accompany behavior tests.
- Fix the product, not the expectation. Do not loosen an assertion to make a bug pass.
- Bug fixes get a regression test that fails before the fix.

## Required coverage by area

| Area | Must test |
|---|---|
| Nutrition | kcal/macros for g, ml, portion, piece; missing stays missing; rounding |
| Dates | local date assignment, day start, DST, invalid dates |
| Barcode | normalization, 12/13 digit equivalence, unknown, checksum tolerance |
| Coverage | 200+ German corpus, per-chain identity and nutrition rates, every miss lands manually |
| Catalog | seed build filters, import idempotency, bad file keeps old catalog, local resolution |
| Freshness | 90-day revalidation, one per 24 h, correction never overwritten, not_loggable |
| Timezone | day_start, 00:30 assignment, travel, DST transitions |
| Management | saved meals, favorites, custom foods; historical entries survive deletion |
| OFF normalizer | per-100 vs per-serving, kJ fallback, missing fields, malformed JSON |
| Search | German fixtures, punctuation, prefix, short-query fallback, ranking |
| Entries | idempotent PUT, tombstone, undo paths, day totals |
| Sync | duplicates, conflict, tombstone, rejected op in batch, stale cursor, snapshot, randomized convergence |
| Auth | bootstrap, login, logout, expiry, rate limit, CSRF origin, proxy CIDR |
| Migrations | up/down/up, schema snapshot, partial unique barcode |
| Export/import | round-trip, bad schema rejected before write, pre-import snapshot |
| PWA | offline reload, offline write, reconnect sync, update prompt, no API in SW cache |
| Visual | screenshots at 400 px, light/dark, every surface/state | no diff vs approved baseline |
| Edge | Cloudflare Access blocks non-operator emails; no origin port; Access-expiry reauth |
| UI | keyboard path, 400 px, light/dark, axe on each new surface |

## Go

- Table-driven tests where the cases are data.
- `httptest` for handlers; no real server ports.
- `t.Cleanup` for resources; `t.Parallel` only when state is isolated.
- Use `go-cmp` or `testify/require` consistently; do not mix assertion styles in one package.
- Run `go test -race ./...` in CI.
- Fixtures live in `testdata/` and are never generated at test time from the network.

## Frontend

- Vitest + React Testing Library.
- Mock at the network boundary with MSW, not by replacing the repository under test.
- `fake-indexeddb` for Dexie; seed through repositories, not raw table writes, unless the test is about the schema.
- Test the user-visible result, not hook internals.
- For the scanner, test both the native path (mock `BarcodeDetector`) and the ponyfill path (mock the module).
- For charts, test the table alternative and the data mapping; do not snapshot SVG markup.

## E2E

- Playwright, one browser context per test, fresh data directory.
- Camera: a mocked detector for deterministic UI tests; a fake media stream with an EAN-13 Y4M for the native path.
- No arbitrary timeouts. Wait on a visible state or a network response.
- Use `data-testid` only where role or label cannot select the element.
- Every E2E test must fail for a real regression, not for timing.

## CI gates

```
make verify
make coverage
go test -race ./...
pnpm test
make test-e2e
```

- Generated-code diff must be clean.
- A failing test blocks the phase.
- A skipped test needs a written reason in the phase note.

## Anti-patterns

- Testing the mock.
- A test that passes when the database is empty.
- Asserting an error message instead of an error code.
- A flaky test "fixed" with a longer timeout.
- Using production OFF data in CI.
- Committing a fixture captured from a live user session.
- Snapshot-only coverage for a chart, form, or sync state.
