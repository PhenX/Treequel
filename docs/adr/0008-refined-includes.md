# ADR-0008 — Refined includes: filter, order, slice per parent

Status: accepted

## Context

`include` loaded every related row in canonical order. EF Core 5+ refines includes
(`Include(u => u.Orders.Where(…).OrderByDescending(…).Take(3))`); the `IncludeSpec` was designed with a slot for
this.

## Decision

1. **The refinement is a second argument**, a callback over a minimal builder:
   `include(u => u.orders, q => q.filter(p).orderByDescending(k).take(3))` — `filter`, `orderBy`/`thenBy` (and
   descending forms), `take`, `skip`; nothing else. The spec carries the ops plus per-parent `take`/`skip`;
   `thenInclude` takes the same argument.
2. **Slices are per parent** — `take(3)` keeps three children *per row*, the EF semantics — and **require an order**
   (R2008 otherwise): a nondeterministic per-parent slice is a bug factory. Slicing happens after ordering; further
   refinement after `take`/`skip` is rejected.
3. **An explicit order replaces the canonical attachment order.** The shared stitcher keeps the fetched sequence when
   the spec is ordered; unordered includes keep the canonical deterministic order.
4. **SQL folds the refinement into the batched fetch.** Filters and ordering extend the
   `WHERE key IN (…)` statement (filters may use navigation predicates — the child table shape keeps its source);
   per-parent slices compile to `ROW_NUMBER() OVER (PARTITION BY key ORDER BY …)` with the row marker stripped
   before stitching. Still one statement per navigation per chunk. A dialect may declare
   `windowFunctions: false` to refuse slices instead of miscompiling.
5. **A refined include is stated once per navigation.** Merging two refinements would guess at semantics; repeated
   *unrefined* mentions keep merging their `thenInclude` branches as before (R2008 on conflict).
6. **The build transform treats the builder callback's parameter as a traced receiver**, so inline lambdas inside
   `q.filter(o => …)` reify exactly like top-level query lambdas — no `expr()` ceremony inside refinements.

## Consequences

- Five conformance cases (filtered, ordered, top-one-per-parent, navigation-predicate filters, refined
  `thenInclude`) run on the memory reference, sql.js and PGlite; the SQLite suite pins the window SQL, the marker
  stripping, and the no-window refusal; error paths (slice without order, refine after slice, double refinement) are
  unit-pinned.
- `SqlDialect` gains optional `windowFunctions`; `IncludeSpec` gains `ops`/`take`/`skip`.
