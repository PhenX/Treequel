# ADR-0006 — Correlated projections and the recognized reduce idiom

Status: accepted

## Context

ADR-0005 gave predicates navigation quantifiers (`some`/`every` → `EXISTS`). Projections, `orderBy` keys and
aggregate selectors still could not measure a navigation — no order counts, no per-row sums — and every candidate
surface for "sum" had a flaw: arrays have no `.sum()` in JS (a made-up method would crash the memory engine and break
typing), and a general `reduce` translation is unsound.

## Decision

1. **Measurements are the JS the row types already admit.** `nav.length` → correlated
   `(SELECT COUNT(*) …)`; `nav.filter(p).length` → filtered count; chains of `filter` compose, and their predicates
   may reference nested navigations. Everything is plain, typed TypeScript that executes natively on attached arrays
   in memory.
2. **Sum is a recognized idiom, not general `reduce`:** exactly `nav.reduce((acc, o) => acc + expr, seed)` with a
   constant numeric seed and the accumulator on one side of the `+`, translated to
   `(seed +) COALESCE((SELECT SUM(expr) …), 0)`. Any other reduce shape is refused with R2001 naming the recognized
   form — an idiom whitelist, never a guess (`min`/`max`/`avg` idioms can be added the same way when they earn it).
3. **One resolution path for every expression position.** The memory engine derives include specs from `select`,
   `orderBy`, `groupBy` and aggregate exprs exactly as it does for predicates, evaluates against navigation-augmented
   copies, and never leaks attachments; sort keys are computed once per row. SQL needs no per-position work — the
   translations live in the expression translator, so they hold wherever an expression appears.
4. **Aggregate subqueries are float-cast** (`COUNT(*)::float8`, `CAST(SUM(…) AS REAL)`) so drivers that return
   bigint/numeric as strings (node-postgres) still produce JS numbers, matching the memory reference — the same rule
   the executor aggregates already followed.
5. **Partial evaluation preserves method-call shape.** Folding previously collapsed a closed callee like
   `cities.includes` into a bound-function `Constant`, making captured-array membership untranslatable. A call that
   cannot fold whole now folds only its receiver and arguments — `Constant([…]).includes(u.city)` survives for the
   translator. The playground's sample gallery is the visible beneficiary.

## Consequences

- `filter` and `reduce` join the WellKnown array vocabulary. Six conformance cases (counts, filtered counts, sums,
  count-ordered, count-filtered, aggregate-of-sums) plus a captured-array membership case run on the memory
  reference, sql.js and PGlite; the SQLite suite pins the emitted subquery shapes and the idiom refusal.
- The playground gains a sample gallery (filters, projections, membership, quantifiers, counts, sums) over a demo
  `users → orders → items` schema with declared relations and mapped physical columns.
- Correlated *row* subqueries (projecting a related entity) and `IN (SELECT …)` against another query remain open —
  tracked in the roadmap issue.
