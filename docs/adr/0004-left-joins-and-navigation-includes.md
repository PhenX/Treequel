# ADR-0004 — First-class left joins and navigation includes

Status: accepted

## Context

The query layer had `join` (inner, memory-only) and no way to load related rows onto parents. EF Core users expect
`Include`/`ThenInclude` and left joins; the SQL providers translated neither, and several op orderings
(`where` after `select`, `take` before `skip`) compiled to SQL that diverged from the memory reference.

## Decision

1. **`leftJoin` is a first-class operator**, not a `groupJoin`/`DefaultIfEmpty` encoding. Its result selector receives
   `U | null`; strict TypeScript forces null-safe projections, which coincide with SQL `NULL` propagation, so one
   lambda means the same thing on both engines.
2. **Null join keys never match** — the SQL rule becomes the reference semantics. The memory hash join skips
   `null`/`undefined` keys (and composite keys with a nullish member); `leftJoin` emits the unmatched outer row with a
   `null` partner. Conformance cases pin this.
3. **Navigations are declared once in the query layer** via `defineRelations<Schema>()` passed to `createContext`.
   `include()` resolves the navigation there and embeds a self-contained `IncludeSpec` (nav, target, from/to keys,
   cardinality, children) in the plan. Providers read only the spec — no relation metadata crosses the provider
   protocol.
4. **Navigation selectors are probed, not captured.** `include(u => u.orders)` is invoked once with a recording proxy
   over `compiled`; a single property access is required. No expression tree is involved, so includes work identically
   with the build plugin, the runtime fallback, or neither. `include`/`thenInclude` are deliberately absent from the
   transform's traced-method list.
5. **SQL executes includes as split queries** (the no-cartesian-explosion strategy): per navigation, one batched fetch
   — `= ANY($n)` on Postgres, chunked `IN (…)` on SQLite via the new optional `SqlDialect.maxBatchKeys` — recursively
   for `thenInclude`, stitched by shared helpers in `@greffon/linq` (`collectIncludes`, `collectKeys`,
   `attachChildren`). Children attach in canonical JSON order because SQL row order without `ORDER BY` is undefined;
   both engines use the same stitcher, so the reference and SQL agree byte-for-byte.
6. **The SQL compiler is a layer stack.** Each op extends the current SELECT or, when SQL clause order would change
   the meaning (`where` over a projection, `distinct` under `take`, a join onto a shaped layer), wraps it into a
   derived table and continues. `TranslateContext` now binds lambda parameters to shapes (`table`, `derived`,
   `scalar`) instead of a single table, which is what makes two-sided join expressions and post-projection operators
   translatable. Parameters are emitted as position-independent markers and rewritten to dialect placeholders in
   textual order (`finalizeSql`), because translation order and clause order differ in a layered statement.
7. **Includes attach to the final rows** and are position-independent in the chain; they are invisible to
   `where`/`select` of the same query (EF Core's rule). Scalar executors ignore them. A projection that drops the
   parent key fails fast (R2002). New diagnostics: R2007 (unknown navigation), R2008 (invalid selector / misplaced
   `thenInclude`).

## Consequences

- `PlanOp` gains `leftJoin` and `include`; `TranslateContext`'s constructor changed (pre-0.1 break, provider-author
  facing). `take(n).skip(m)` now composes as the slice it describes (`LIMIT max(0, n-m) OFFSET m`) — the previous SQL
  rendering diverged from the reference.
- The conformance corpus wraps its lambdas in `expr()` and gained join/include cases plus `defaultRelations()`;
  provider suites run the full corpus on PGlite and sql.js.
- `@greffon/linq` stays within its 4 kB min+gz budget (3.31 kB after the change).
