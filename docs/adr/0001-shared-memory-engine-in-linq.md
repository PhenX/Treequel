# ADR 0001 — The in-memory execution engine lives in `@treequel/linq`

Status: accepted

## Context

The plan describes `@treequel/provider-memory` as the reference provider that owns the in-memory execution
semantics. Separately, the `.inMemory()` boundary operator must run the suffix of a plan in memory over rows a remote
provider has already materialized. If the semantics lived only in `provider-memory`, the query layer (`@treequel/linq`)
would need to depend on `provider-memory` to implement `.inMemory()` — but `provider-memory` already depends on `linq`,
which would create a dependency cycle.

## Decision

The op-application engine (`applyOps` / `runPlanInMemory`) lives in `@treequel/linq`. `@treequel/provider-memory` is a
thin wrapper that adapts it to the `QueryProvider` interface, and the `.inMemory()` boundary reuses the same engine for
the client-evaluated suffix.

## Consequences

- One implementation defines the reference semantics; the provider and the boundary can never diverge from it.
- The dependency graph stays acyclic (`provider-memory` → `linq`, never the reverse), as enforced by
  `scripts/check-graph.mjs`.
- `provider-memory` is smaller than the plan anticipated; the "reference semantics" role is unchanged — it just points
  at the shared engine instead of re-implementing it.
