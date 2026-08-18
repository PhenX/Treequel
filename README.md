# Greffon

**Expression trees for TypeScript.** Write an ordinary lambda; it stays the function it always was, and becomes a
typed, serializable tree you can evaluate, rewrite, print, store, send over the wire — or hand to a provider that
translates it: a policy check, a remote filter, parameterized SQL. One application is LINQ-style querying: the same
query file runs against fixture arrays in your tests and compiles to parameterized SQL in production.

## One lambda, three lives

```ts
import { expr, serialize } from "@greffon/core";

const minAge = 18;
const isAdult = expr((u: User) => u.age >= minAge);

isAdult.compiled({ id: 1, name: "Ada", age: 36 }); // runs — still the function it always was
JSON.stringify(serialize(isAdult.body)); // serializes — versioned JSON to store, ship, audit
await db.users.filter(isAdult).toArray(); // translates — WHERE "t0"."age" >= $1
```

At a traced query call site the `expr()` marker is not even needed — the build plugin reifies plain lambdas, and the
[toolkit](https://phenx.github.io/Greffon/guide/the-tree) (`evaluate`, `partialEval`, `print`, `rewrite`, the `b`
node builders) works on every tree, with zero dependencies and no provider involved.

## Querying

```ts
const adults = await db.users
  .filter(u => u.age >= minAge && u.name.startsWith(prefix))
  .map(u => ({ id: u.id, name: u.name }))
  .toArray();
// → SELECT "t0"."id" AS "id", "t0"."name" AS "name" FROM "users" "t0"
//   WHERE ("t0"."age" >= $1 AND "t0"."name" LIKE $2 ESCAPE '\')
```

The same query file runs under Vitest with no plugin configured, against fixture arrays, producing equal results — the
in-memory provider is the reference semantics, and the SQL providers are property-tested against it. Joins,
split-query `include`/`thenInclude`, grouping, and computed members are covered in the
[querying guide](https://phenx.github.io/Greffon/guide/getting-started).

## What you can build on it

One definition, because it is both a function and data, does several jobs:

- **Queries** — fixtures in tests, parameterized SQL in production, one file.
- **Authorization & policy** — the rule that filters every list query is also the `evaluate` check on one object,
  the UI's show/hide, and an auditable row in a policy store ([runnable example](examples/policy-rules)).
- **Filters & saved searches over the wire** — a client sends a serialized tree; the server re-validates it against
  the closed grammar, then translates or interprets it. No bespoke filter DSL ([runnable example](examples/wire-filter)).
- **Rules as data** — flag targeting, alert conditions, eligibility: plain-JSON trees an admin UI can edit and
  `print` can render for review.
- **Workers, edge, CSP** — trees are `structuredClone`/`postMessage`-safe and `evaluate` needs no `new Function`.
- **Meta-tooling** — trees as cache keys, structural assertions in tests, `rewrite` folding a tenant filter into
  every query.

The [Applications](https://phenx.github.io/Greffon/guide/applications) page is the full catalog.

## How it works

From lambda to tree:

1. You write `u => u.age > minAge` — at a traced query call site, or wrapped in `expr()` anywhere.
2. At build time the Vite plugin validates the lambda against a small closed subset and reifies it into
   `__expr({ compiled, params, body, scope })` — keeping the original lambda as `compiled` and inlining the tree as a
   plain object.

From tree to answers:

3. Any tree can be run (`compiled`, or `evaluate` with no function at all), serialized, printed, or rewritten —
   no provider involved.
4. In a query, each operator appends one op to an immutable `QueryPlan`. On execution (`await`/`toArray()`) the
   provider folds captured free variables to constants against the live closure, then translates the residual tree:
   the SQL providers to parameterized SQL, the memory provider by calling `compiled`.

Without the plugin, in-memory paths work fully; remote providers fall back to a runtime parse and report a teachable
error naming any captured variable (`import "@greffon/fallback/register"` to enable that path).

## Packages

The tree and its toolkit — the product:

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@greffon/tree`](packages/tree) | Node types, (de)serialization, JSON schema — the wire format | none |
| [`@greffon/core`](packages/core) | `Expr`, visitor/rewriter, `evaluate`, partial evaluation, printer, `b` builders | `tree` |
| [`@greffon/capture`](packages/capture) | The shared subset validator, free-variable analysis, serializer | `tree` |

Capturing lambdas at build time, and keeping the editor honest:

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@greffon/transform`](packages/transform) | Pure per-module build transform | `tree`, `capture`, `oxc-parser`, `magic-string` |
| [`@greffon/vite`](packages/vite) | Thin Vite / Rollup / Rolldown plugin | `transform` |
| [`@greffon/ts-transformer`](packages/ts-transformer) | TypeScript-compiler transformer for `tsc`-only builds | `transform` |
| [`@greffon/fallback`](packages/fallback) | Runtime `toString()` capture (dev-only, lazy) | `core`, `capture`, `meriyah` |
| [`@greffon/ts-plugin`](packages/ts-plugin) | In-editor subset diagnostics | `capture`, `oxc-parser` |
| [`@greffon/eslint-plugin`](packages/eslint-plugin) | The same rules, lint-gated | `capture` |

Querying:

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@greffon/query`](packages/query) | `Queryable`, `QueryPlan`, provider protocol, `createContext` | `core` |
| [`@greffon/provider-memory`](packages/provider-memory) | Reference provider (defines the semantics) | `core`, `query` |
| [`@greffon/sql-core`](packages/sql-core) | Shared SQL-translation core (dialect seam, translator, builder) | `core`, `query` |
| [`@greffon/provider-postgres`](packages/provider-postgres) | Tree → parameterized Postgres | `sql-core` |
| [`@greffon/provider-sqlite`](packages/provider-sqlite) | Tree → parameterized SQLite | `sql-core` |

The subset validator, free-variable analysis, and tree serializer live once in `@greffon/capture` and are reused by
the build transform, the runtime fallback, the language-service plugin, and the ESLint rule, so the editor, the build,
the lint, and the fallback agree on what is legal.

## The subset

Query lambdas are expression-bodied arrows over a small closed grammar: member and index access, calls,
binary / logical / unary / ternary operators, template / object / array literals, and nested lambdas for `some` and
`every`. Out-of-subset syntax is rejected with a coded, located diagnostic — the same message in the editor, in ESLint
or oxlint, and at build time. Loose equality (`==` / `!=`) is rejected (`R1103`, autofixed to `===` / `!==`).

## Lineage

Code-as-data is an old idea; the specific shape here — a lambda whose static type makes it both a function and a
tree — is C#'s `Expression<Func<T, bool>>`, rebuilt with a build-time plugin standing in for the C# compiler. The SQL
providers borrow EF Core's provider playbook (split-query `include`/`thenInclude`, parameterized SQL, no silent
client-side evaluation), and the memory provider plays LINQ to Objects' role as the reference semantics. The docs map
the concepts in [The C# lineage](https://phenx.github.io/Greffon/guide/lineage) and place Greffon next to ORMs,
query builders, and rules engines in
[Compared to ORMs & rules engines](https://phenx.github.io/Greffon/guide/comparison).

## Status

Pre-0.1, under initial construction — nothing is published to npm yet. The API shown above is the design target, not a
released surface.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, checks, commit conventions
- [AGENTS.md](AGENTS.md) — repository structure and the conventions that apply to every change

## License

[MIT](LICENSE)
