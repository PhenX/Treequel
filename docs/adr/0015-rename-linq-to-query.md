# ADR 0015 — Rename `@greffon/linq` to `@greffon/query`

Status: accepted

## Context

The plan named the query layer `@greffon/linq` after its C# ancestor, and the name shipped through M0–M7. Meanwhile
the project's stated positioning is that expression trees are the product and querying is the flagship *application*
(plan §1.4), and ADR-0013 already renamed the operators themselves after their JavaScript `Array` equivalents —
`filter`/`map`, not `Where`/`Select` — precisely so a query reads as TypeScript rather than as transplanted C#.

The package name pulled the other way. "LINQ" names the .NET database-query stack in most readers' minds, and it
appeared in the highest-frequency surfaces the project has: every install command (`npm i @greffon/linq`), every
import line, the dependency tables. A project trying not to be read as "EF Core for TypeScript" was asking every user
to type the one word that most strongly makes that association.

## Decision

Rename the package and its directory: `@greffon/linq` → `@greffon/query`, `packages/linq/` → `packages/query/`.
The name states the role — the query layer over expression trees — and leaves the C# ancestry to the docs.

The public export surface is unchanged; only the specifier moves, including the testing subpath
(`@greffon/linq/testing` → `@greffon/query/testing`). The dependents update their imports (`provider-memory`,
`sql-core`, the SQL providers' tests, both examples, the playground, the docs), as do the dependency-graph allowlist,
the TypeScript project references, the Vitest aliases and reify include, the issue-form package list, and the
Conventional-Commits scope (`linq` → `query`; commits on main keep the old scope, and CI lints only PR ranges).

LINQ remains the name of the idea in prose: the lineage page still maps `Queryable` to `IQueryable<T>`, the docs still
say "LINQ-style querying", and `linq` stays an npm keyword on the query and provider packages so the C# diaspora can
find them.

## Consequences

- Install commands and imports name the role, not the ancestor. The word LINQ now appears where lineage is the topic,
  not in every consumer's `package.json`.
- No consumer break: `0.1.0` is unpublished, so no released import path changes. Had it been published, this would be
  a breaking rename.
- Earlier ADRs and the plan keep the historical name in their text; this ADR records the mapping. ADR-0001's title
  ("shared memory engine in linq") reads with the old name — its decision, one shared in-memory engine inside the
  query layer, stands unchanged.
