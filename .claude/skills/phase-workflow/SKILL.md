---
name: phase-workflow
description: Use when starting, resuming, or finishing a Phase 0-12 unit of work in this repository. Enforces the task plan, dependency order, tracker updates, and review pauses in .claude/tasks.
---

# Phase workflow

The plan in `.claude/tasks` is the contract. This skill keeps work inside the current phase and makes progress survive a context reset.

## Before coding

1. Read `.claude/tasks/README.md` and find the first unchecked phase.
2. Confirm every dependency is checked. If not, stop and say which dependency is missing.
3. Read `.claude/tasks/00-architecture.md` and the phase file in full.
4. Read the files the phase names. Do not assume their contents.
5. Check the phase's `Status` line. If it is `blocked`, do not start.
6. Open Phase 0 items (device scan runs, the real corpus) do not block production code. They gate launch (Phases 11 and 12), not development.

## While coding

- Implement only what the phase lists. A later-phase feature found along the way goes into the phase file as a note, not into the diff.
- Keep the phase's acceptance checklist visible. Mark items as they are truly verified, not as they are attempted.
- Run the narrow test for the area before running the full suite.
- If a locked decision must change, edit `00-architecture.md` first and record why. Then update every affected phase.
- Do not add a dependency without a one-line justification in the phase file.

## When finishing

1. Run the phase's verification commands and `make verify`.
2. Walk the acceptance checklist item by item. An unchecked item means the phase is not done.
3. Update the phase `Status` and the README progress tracker.
4. Record what was verified, what was not, and any follow-up in one short note at the bottom of the phase.
5. Stop at a review pause (Phases 0, 4, 6, 9, 12) and ask for review before the next phase.
6. If not a pause phase, proceed to the next unblocked phase without asking again, per the user's end-to-end preference.

## Reporting

Report in this order:

- What changed
- What was verified, with commands
- What was not verified, and why
- Open risks or decisions
- Next phase

Do not claim a phase is complete when a deployment, device, or restore step was skipped. Say exactly what remains.

## Anti-patterns

- Changing sync behavior without the sync invariant tests passing first.
- Marking a checklist item done because the code compiles.
- Silently changing the em dash-free copy style, the design tokens, or a stack choice.
- Bundling two phases in one review.
- Updating the tracker to match the work instead of the work to match the tracker.
