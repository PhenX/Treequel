# ADR 0010 — Rename `@treequel/provider-sql` to `@treequel/sql-core`

Status: accepted

## Context

ADR-0003 established a `SqlDialect` seam and kept `@treequel/provider-sql` as the shared, dialect-agnostic core that the
Postgres and SQLite providers build on — "retained as the shared core, not a provider." The name carried over from the
plan's original single-`provider-sql` packaging.

That name misleads. A reader scanning `packages/` sees four `provider-*` directories and reasonably expects four runnable
providers, but `provider-sql` exports no provider — there is no `sqlProvider(...)`. It is a toolkit: the translator,
the `SqlDialect` interface, and the `makeSqlProvider` builder. The `provider-` prefix advertises the wrong role, and the
package sat beside three genuine providers (`memory`, `postgres`, `sqlite`) that all depend on it.

Independently, the shared package's `src/index.ts` had grown into an 882-line file spanning the layer compiler, the
plan-to-statement entry, the include-stitching engine, and the public barrel, with a second 658-line `translate.ts` —
so the package was already being reorganized when the naming question resurfaced.

## Decision

Rename the package and its directory: `@treequel/provider-sql` → `@treequel/sql-core`, `packages/provider-sql/` →
`packages/sql-core/`. The name states the role — a shared SQL core, not a provider — and leaves `provider-*` to mean
exactly the runnable providers.

The public export surface is unchanged; only the specifier moves. The dependents update their import from
`@treequel/provider-sql` to `@treequel/sql-core` (the two dialect packages and the SQLite reify suite), as do the
dependency-graph allowlist, the TypeScript project references, the Vitest alias, and the docs. The Conventional-Commits
scope stays `sql`, which already covered all four SQL packages.

## Consequences

- `packages/` now reads honestly: `sql-core` (the toolkit) beside `provider-memory` / `provider-postgres` /
  `provider-sqlite` (the providers). A newcomer no longer has to learn that one `provider-*` is a library.
- No consumer break: `0.1.0` is unpublished, so no released import path changes. Had it been published, this would be a
  breaking rename.
- This supersedes the package name chosen in ADR-0003; that ADR's two-layer decision (a dialect seam plus one package per
  dialect) stands unchanged.
- The rename shipped alongside the internal decomposition of the core into focused modules
  (`context` / `patterns` / `translate` / `compiler` / `compile` / `include-sql` / `provider`, with `index.ts` a thin
  barrel); the two are independent but landed together while the package was open.
