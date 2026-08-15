# ADR-0007 — GROUP BY through recognized idioms

Status: accepted

## Context

`groupBy` ran only in memory (`Grouping<K, T>` with a real `items` array); SQL providers refused it. EF Core users
expect grouped aggregate queries. The surface question was the same one ADR-0006 answered for navigations: what do
aggregates *look like* in typed JS that also runs natively on the reference engine?

## Decision

1. **The projection measures `g.items` with the same idioms navigations use.** `g.items.length` → `COUNT(*)`;
   `g.items.filter(p).length` → `COUNT(CASE WHEN p THEN 1 END)`; `reduce((acc,o) => acc + e, seed)` → `SUM`;
   `reduce((m,o) => Math.min(m, e), Infinity)` → `MIN` (and the `Math.max`/`-Infinity` twin). Averages are plain
   arithmetic (`sum / count`), no idiom needed. `MIN`/`MAX` idioms require their identity seeds and refuse `.filter()`
   composition — a filtered-empty bucket is `NULL` in SQL but the seed in JS, and refusal beats divergence. Groups
   themselves are never empty, which is what makes `MIN`/`MAX` sound here and unsound over navigations.
2. **`groupBy` holds the layer open until its projection.** The compiler stores the translated key parts and the
   pre-group row shape; the next `select` translates against a `group` shape (`g.key`, `g.key.prop` for composite
   keys, `g.items` aggregates) and emits one `GROUP BY` statement. Any other operator over a pending group — and
   materializing raw groups — is refused (R2001): `Grouping` has no faithful single-query SQL shape, so raw groups
   stay memory-only.
3. **Non-column keys precompute into a derived table.** A grouped SELECT cannot re-evaluate a correlated subquery
   (Postgres: "subquery uses ungrouped column"), and even where an engine allows a repeated expression it computes
   twice. Any key part that is not a bare column is materialized as `__tql_gN` in an inner SELECT and grouped by
   name — so `groupBy(u => u.orders?.length ?? 0)` works on every engine.
4. **`where` after the group projection wraps into a derived table** — semantically `HAVING`, with no dedicated
   clause to maintain; `orderBy`/`take`/`skip` compose as usual, and `groupBy(...).count()` counts groups via the
   existing `SELECT 1` shell.
5. **Aggregate lambdas translate against a source-stripped item shape**: navigation resolution inside group
   aggregates is refused on SQL rather than silently disagreeing with the reference, which does not attach
   navigations to grouped items.

## Consequences

- `groupBy` joins the SQL providers' supported ops; eight conformance cases (counts, composite keys,
  sum/min/max/average, filtered counts, HAVING-style filters, ordered slices, group counts, navigation-count keys)
  run on the memory reference, sql.js and PGlite. The memory engine needed no aggregate work — the idioms are real
  JS over the real `items` array.
- The memory engine now scopes navigation resolution to source-shaped rows: `select`/`groupBy`/`join` clear the
  resolution scope, mirroring the SQL compiler, so a projected property that happens to share a navigation's name is
  never mis-resolved.
