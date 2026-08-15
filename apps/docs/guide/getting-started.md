# Getting started

Treequel turns ordinary query lambdas into expression trees at build time. You write a lambda; a provider translates
the tree. The same query runs in memory in your tests and compiles to parameterized SQL in production.

## Install

```sh
npm i @treequel/linq @treequel/provider-memory
npm i -D @treequel/vite
```

Add the plugin to your Vite config. It reifies traced query lambdas into expression trees; it uses only
Rollup-compatible hooks, so the same plugin works in Vite, Rollup, and Rolldown.

```ts
// vite.config.ts
import { treequel } from "@treequel/vite";

export default {
  plugins: [treequel()],
};
```

## Write a query

A context is the traced root. Property access on it (`db.users`) is a `Queryable`; every operator returns a new,
immutable query. Execution is explicit — `toArray()`, `first()`, `count()`, and so on.

```ts
import { createContext } from "@treequel/linq";
import { memoryProvider } from "@treequel/provider-memory";

interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

const users: User[] = [
  { id: 1, name: "Ada", age: 36, active: true },
  { id: 2, name: "Bob", age: 17, active: true },
];

const db = createContext<{ users: User }>(memoryProvider({ users }));

const adults = await db.users
  .where((u) => u.age >= 18 && u.active)
  .select((u) => ({ id: u.id, name: u.name }))
  .toArray();
// [{ id: 1, name: "Ada" }]
```

Queries over more than one source — `join`, `leftJoin`, and EF-style `include`/`thenInclude` — are covered in
[Joins & includes](/guide/joins-and-includes).

## The same query, on Postgres

Swap the provider. The query definitions do not change. The Postgres provider takes a driver `executor` — it works over
`pg`, `postgres.js`, Neon, or PGlite — and explicit schema metadata.

```ts
import { postgres } from "@treequel/provider-postgres";

const db = createContext<{ users: User }>(
  postgres(executor, { users: { table: "users" } }),
);

await db.users.where((u) => u.age >= 18 && u.active).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1 AND "users"."active")
```

Constants become bound `$n` parameters — values are never interpolated into the SQL string. Call `explain()` on any
query to see the text a provider would run.

## The same query, on SQLite

The SQLite provider is the same story with a SQLite `executor` (`better-sqlite3`, `node:sqlite`, sql.js, …). It emits
positional `?` parameters, case-sensitive `GLOB` matching, and Postgres-style null ordering, so its results match the
memory reference row for row.

```ts
import { sqlite } from "@treequel/provider-sqlite";

const db = createContext<{ users: User }>(
  sqlite(executor, { users: { table: "users" } }),
);

await db.users.where((u) => u.age >= 18 && u.name.startsWith("A")).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= ? AND ("users"."name" GLOB ?))
```

SQLite has no boolean type, so model boolean columns as `0`/`1`.

## Without the plugin

In-memory paths work with no plugin: the memory provider calls your compiled lambda directly and never needs the tree.
A remote provider does need the tree, so without the plugin it falls back to parsing `Function.prototype.toString()`.
That path is closure-blind: a lambda capturing a variable reports [R3002](/errors#R3002) naming the variable, rather
than returning a wrong result. Enable it with:

```ts
import "@treequel/fallback/register";
```

## Lint

`@treequel/eslint-plugin` runs the same subset validator as the build and the editor, so an invalid lambda fails at
lint time with the same coded message. It is an ESLint plugin, and oxlint loads ESLint plugins through `jsPlugins`
(alpha, not semver-guarded) — one package covers both linters.

::: code-group

```js [eslint.config.js]
import treequel from "@treequel/eslint-plugin";

export default [treequel.configs.recommended];
```

```json [.oxlintrc.json]
{
  "jsPlugins": [{ "name": "treequel", "specifier": "@treequel/eslint-plugin" }],
  "rules": {
    "treequel/valid-expression": "error",
    "treequel/no-opaque-callback": "warn"
  }
}
```

:::

The rules match query methods by name, without type information — `treequel/no-opaque-callback` is a warning because a
bare identifier can also hold an `expr()`-built tree, and an unrelated API can share an operator name. Scope the rules
to your query modules with overrides if that happens; the build transform and the editor plugin are not affected, since
they trace your context imports instead of matching names.

## Coming from somewhere else?

- From C#: LINQ and EF Core are this design's ancestors, and the concepts map one-to-one —
  [The C# lineage](/guide/lineage).
- From Prisma, Drizzle, Kysely, TypeORM, or MikroORM: Treequel is not an ORM, and the overlap is narrower than it
  looks — [Compared to ORMs & EF Core](/guide/comparison).
