# ADR 0003 — SQL providers: per-dialect packages over a shared core, SQLite in 0.1

Status: accepted

## Context

The plan (§10.2, §16) makes `@treequel/provider-sql` "Postgres first" — one package with a dialect table — and
schedules `mysql`/`sqlite` for the post-0.1 backlog. Two things changed: SQLite was pulled into the 0.1 scope, and a
second first-party target made the packaging question concrete.

Postgres-specific SQL was spread across the translator and the plan compiler: `$n` placeholders, `LIKE … ESCAPE`,
`= ANY(array)`, `::float8` casts, and a bare `OFFSET`. SQLite differs on every one of those, and — because the memory
provider is the reference semantics — a second dialect has to produce SQL that returns the *same rows*, not merely valid
SQL. A single package exporting `sqlProvider` (which meant Postgres) plus `sqliteProvider` also read awkwardly.

## Decision

Two layers:

1. **A `SqlDialect` seam.** `@treequel/provider-sql` becomes the shared, dialect-agnostic core: the translator
   (`translate`, `TranslateContext`, `quoteIdent`), the `SqlDialect` interface + escape helpers, and the provider
   builder `makeSqlProvider`. It captures exactly the pieces that vary — placeholder rendering, string matching, array
   membership, float casts, the `OFFSET`/`LIMIT` rule, null ordering, and driver value coercion.

2. **One package per dialect.** `@treequel/provider-postgres` exports `postgres(...)` + `pgDialect`;
   `@treequel/provider-sqlite` exports `sqlite(...)` + `sqliteDialect`. Each is a thin package that supplies a
   `SqlDialect` and calls `makeSqlProvider`, and depends **only** on `@treequel/provider-sql` (which re-exports the
   `QueryProvider` type and the schema/executor types). Factory functions, not classes — consistent with
   `memoryProvider` and friendlier to tree-shaking.

`sqliteDialect` reaches memory-reference parity with: positional `?` parameters; **case-sensitive `GLOB`** for
`startsWith`/`endsWith`/`includes` (SQLite `LIKE` is case-insensitive), with `*?[` escaped; `IN (…)` membership (no array
parameter), empty set compiled to a false literal; `CAST(… AS REAL)` aggregates; explicit `NULLS LAST`/`NULLS FIRST` to
match Postgres and the memory engine; `LIMIT -1 OFFSET n` for a bare skip; and boolean → `0`/`1` coercion (SQLite has no
boolean type).

## Consequences

- The dialect seam is the extension point a future MySQL dialect — or a third-party one — slots into: publish a package
  that depends on `@treequel/provider-sql` and calls `makeSqlProvider`. Postgres and SQLite are just the first two.
- Three packages instead of one, and two more edges in `scripts/check-graph.mjs`. Lockstep versioning means no
  independent-version benefit, but the import surface is now symmetric and self-describing
  (`postgres` / `sqlite`), and each provider documents itself.
- `sql.js` (WASM SQLite, no native build) joins the dev dependencies as the SQLite counterpart to PGlite; a reify suite
  and a fast-check predicate-parity property test assert `sqlite ≡ memory`, mirroring the Postgres coverage.
- All four SQL packages keep zero runtime dependencies; the dialects are code, and the drivers are test-only.
- Postgres output and behavior are unchanged (its byte-for-byte SQL is still pinned by the Postgres suite).
- This supersedes the plan's single-`provider-sql` packaging (§3, §10.2); `provider-sql` is retained as the shared core,
  not a provider.
