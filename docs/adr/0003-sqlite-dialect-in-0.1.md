# ADR 0003 — SQLite ships in 0.1 via a dialect seam in `@treequel/provider-sql`

Status: accepted

## Context

The plan (§10.2, §16) makes `@treequel/provider-sql` "Postgres first" and schedules the `mysql`/`sqlite` dialects for
the post-0.1 backlog. A second target was pulled into the 0.1 scope, so SQLite lands now.

Postgres-specific SQL was spread across the translator and the plan compiler: `$n` placeholders, `LIKE … ESCAPE`,
`= ANY(array)`, `::float8` casts, and a bare `OFFSET`. SQLite differs on every one of those, and — because the memory
provider is the reference semantics — a second dialect has to produce SQL that returns the *same rows*, not merely valid
SQL.

## Decision

Introduce a small `SqlDialect` seam (`packages/provider-sql/src/dialect.ts`) capturing exactly the pieces that vary:
placeholder rendering, string matching, array membership, float casts, the `OFFSET`/`LIMIT` rule, null ordering, and
driver value coercion. `translate()` and `compile()` delegate to it; `pgDialect` is the default and its output is
byte-identical to before (the existing pg tests pin it). `sqlProvider` stays the Postgres entry point; `sqliteProvider`
is added alongside.

`sqliteDialect` reaches memory-reference parity with:

- positional `?` parameters;
- **case-sensitive `GLOB`** for `startsWith`/`endsWith`/`includes` (SQLite `LIKE` is case-insensitive), with `*?[`
  escaped;
- `IN (…)` membership (no array parameter), with an empty set compiled to a false literal;
- `CAST(… AS REAL)` for `count`/`sum`/`avg`;
- explicit `NULLS LAST`/`NULLS FIRST` so ordering matches Postgres and the memory engine;
- `LIMIT -1 OFFSET n` for a bare skip;
- boolean → `0`/`1` value coercion (SQLite has no boolean type).

## Consequences

- `@treequel/provider-sql` is multi-dialect. The seam is the extension point a future MySQL dialect slots into, so
  pulling SQLite forward also de-risks the rest of the backlog.
- `sql.js` (WASM SQLite, no native build) joins the dev dependencies as the SQLite counterpart to PGlite; a reify suite
  and a fast-check predicate-parity property test assert `sqlite ≡ memory`, mirroring the Postgres coverage.
- `@treequel/provider-sql` keeps its zero runtime dependencies; the dialect is code, and `sql.js` is test-only.
- Postgres output and behavior are unchanged.
- SQLite's lack of a boolean type is a modeling note for users (columns are `0`/`1`), surfaced in the getting-started
  guide.
