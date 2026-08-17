# Treequel

> Trees in, queries out. The sequel is trees.

**Expression trees and LINQ for TypeScript.** Write an ordinary lambda; it stays the function it always was, and
becomes a typed, serializable expression tree that providers translate to SQL, remote filters, policy checks — or
anything else. The same query file runs against fixture arrays in your tests and compiles to parameterized SQL in
production. Expression trees are the product; LINQ is the flagship application. Not an ORM.

```ts
const adults = await db.users
  .filter(u => u.age >= minAge && u.name.startsWith(prefix))
  .map(u => ({ id: u.id, name: u.name }))
  .toArray();
// → SELECT "t0"."id" AS "id", "t0"."name" AS "name" FROM "users" "t0"
//   WHERE ("t0"."age" >= $1 AND "t0"."name" LIKE $2 ESCAPE '\')
```

The same query file runs under Vitest with no plugin configured, against fixture arrays, producing equal results — the
in-memory provider is the reference semantics, and the SQL provider is property-tested against it.

## How it works

1. You write `db.users.filter(u => u.age > minAge)`.
2. At build time the Vite plugin detects the traced call site, validates the lambda against a small closed subset, and
   reifies it into `__expr({ compiled, params, body, scope })` — keeping the original lambda as `compiled` and inlining
   the tree as a plain object.
3. At runtime `filter()` appends `{ op: "filter", expr }` to an immutable `QueryPlan`.
4. On execution (`await`/`toArray()`) the provider folds captured free variables to constants against the live closure,
   then translates the residual tree: the SQL provider to parameterized SQL, the memory provider by calling `compiled`.

Without the plugin, in-memory paths work fully; remote providers fall back to a runtime parse and report a teachable
error naming any captured variable (`import "@treequel/fallback/register"` to enable that path).

## Packages

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@treequel/tree`](packages/tree) | Node types, (de)serialization, JSON schema — the wire format | none |
| [`@treequel/core`](packages/core) | `Expr`, visitor/rewriter, partial evaluation, printer | `tree` |
| [`@treequel/capture`](packages/capture) | The shared subset validator, free-variable analysis, serializer | `tree` |
| [`@treequel/query`](packages/query) | `Queryable`, `QueryPlan`, provider protocol, `createContext` | `core` |
| [`@treequel/provider-memory`](packages/provider-memory) | Reference provider (defines the semantics) | `query` |
| [`@treequel/sql-core`](packages/sql-core) | Shared SQL-translation core (dialect seam, translator, builder) | `query` |
| [`@treequel/provider-postgres`](packages/provider-postgres) | Tree → parameterized Postgres | `sql-core` |
| [`@treequel/provider-sqlite`](packages/provider-sqlite) | Tree → parameterized SQLite | `sql-core` |
| [`@treequel/transform`](packages/transform) | Pure per-module build transform | `capture`, `oxc-parser`, `magic-string` |
| [`@treequel/vite`](packages/vite) | Thin Vite / Rollup / Rolldown plugin | `transform` |
| [`@treequel/fallback`](packages/fallback) | Runtime `toString()` capture (dev-only, lazy) | `core`, `capture`, `meriyah` |
| [`@treequel/ts-plugin`](packages/ts-plugin) | In-editor subset diagnostics | `capture` |
| [`@treequel/eslint-plugin`](packages/eslint-plugin) | The same rules, lint-gated | `capture` |

The subset validator, free-variable analysis, and tree serializer live once in `@treequel/capture` and are reused by
the build transform, the runtime fallback, the language-service plugin, and the ESLint rule, so the editor, the build,
and the fallback agree on what is legal.

## The subset

Query lambdas are expression-bodied arrows over a small closed grammar: member and index access, calls,
binary / logical / unary / ternary operators, template / object / array literals, and nested lambdas for `some` and
`every`. Out-of-subset syntax is rejected with a coded, located diagnostic — the same message in the editor, in ESLint
or oxlint, and at build time. Loose equality (`==` / `!=`) is rejected (`R1103`, autofixed to `===` / `!==`).

## Lineage

The design is C#'s `Expression<Func<T, bool>>` and `IQueryable<T>` rebuilt for TypeScript, with a build-time plugin
standing in for the C# compiler and EF Core supplying the provider playbook — `include`/`thenInclude` with split
queries, parameterized SQL, and no silent client-side evaluation. The docs map the concepts in
[The C# lineage](https://phenx.github.io/Treequel/guide/lineage) and place Treequel next to Prisma, Drizzle, Kysely,
TypeORM, MikroORM, and EF Core in [Compared to ORMs & EF Core](https://phenx.github.io/Treequel/guide/comparison).

## Status

Pre-0.1, under initial construction — nothing is published to npm yet. The API shown above is the design target, not a
released surface.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, checks, commit conventions
- [AGENTS.md](AGENTS.md) — repository structure and the conventions that apply to every change

## License

[MIT](LICENSE)
