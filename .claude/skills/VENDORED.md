# Vendored skills

## golang-code-style

- Source: https://github.com/samber/cc-skills-golang/tree/ba9cc6d7fdc06f9ced80faa14a7ef3efe010b474/skills/golang-code-style
- Author: Samuel Berthe
- License: MIT, copyright notice in `golang-code-style/LICENSE`
- Vendored: 2026-11-12
- Files: `SKILL.md`, `references/details.md`, `LICENSE`

Only this style skill is vendored. The upstream companion skills (naming, structs/interfaces, error handling, concurrency, context, testing, lint) are not installed. Apply the project rules in `CLAUDE.md` for those concerns.

## Project overrides

`CLAUDE.md` wins whenever this skill conflicts with the project:

- stdlib only; do not add `github.com/samber/lo` or another helper library without a written reason in the phase file.
- chi + Huma, sqlc + goose, and `modernc.org/sqlite` are fixed.
- Ignore the upstream multi-agent orchestration note unless the user explicitly asks for a multi-agent review.
- A nil slice is acceptable where the API contract does not require `[]`; the project rule in `CLAUDE.md` decides.

## Updating

Re-vendor by copying `SKILL.md`, `references/details.md`, and `LICENSE` from a newer upstream commit, then update the commit hash here. Do not edit the vendored files; put project differences in this file or in `CLAUDE.md`.
