# ADR 0002 — Commit the design plan for agent handoff

Status: accepted

## Context

The conventions kept the design & implementation plan (`plans/DESIGN.md`) local and gitignored, on the principle that
once an area is implemented the code, tests, and ADRs are the source of truth and the repository should stand on its
own. The plan was treated as a private working document.

The project owner asked to make the plan available in the repository so a later agent can continue the remaining 0.1
work (property tests, type-tests, SQL `join`/`groupBy`, release automation, and the rest) with the original intent in
hand.

## Decision

Commit `plans/DESIGN.md`. The rest of `plans/` (roadmap, exploration notes) stays local and gitignored — the
`.gitignore` uses `plans/*` with a `!plans/DESIGN.md` exception. The agent/contributor guides are updated to describe
the plan as committed.

## Consequences

- A follow-up agent reads the design directly from the repository rather than needing it re-supplied.
- Code, tests, and ADRs remain the source of truth for *implemented* areas; where the code and the plan disagree, the
  code wins and the divergence is recorded in an ADR (this file included).
- The plan is a snapshot of intent, not a live mirror of the code; it is not kept in lockstep with every change.
