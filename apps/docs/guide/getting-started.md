# Getting started

Greffon turns ordinary lambdas into expression trees at build time. The lambda stays callable; the tree is data you
can evaluate, serialize, or hand to a provider. This page starts with the tree itself, then querying: the same query
running in memory in your tests and compiling to parameterized SQL in production.

## Install

```sh
npm i @greffon/core @greffon/query @greffon/provider-memory
npm i -D @greffon/vite
```

Add the plugin to your Vite config. It reifies traced query lambdas into expression trees; it uses only
Rollup-compatible hooks, so the same plugin works in Vite, Rollup, and Rolldown.

```ts
// vite.config.ts
import { greffon } from "@greffon/vite";

export default {
  plugins: [greffon()],
};
```

Building with the TypeScript compiler directly, no bundler? `@greffon/ts-transformer` does the same job during
`tsc` emit — see [Compiling with tsc](/guide/compiling-with-tsc).

## Your first tree

A tree needs no database and no provider. `expr()` marks a standalone lambda for reification; the result is both the
function it always was and a tree you can print, interpret, and serialize:

```ts
import { evaluate, expr, print, serialize } from "@greffon/core";

const minAge = 18;
const isAdult = expr((u: { age: number }) => u.age >= minAge);

isAdult.compiled({ age: 36 }); // true — the original function, untouched
print(isAdult.body); // "(u.age >= minAge)" — readable, for logs and audits
evaluate(isAdult.body, { params: { u: { age: 36 } }, scope: { minAge } }); // true — no function needed
JSON.stringify(serialize(isAdult.body)); // versioned JSON — store it, send it, diff it
```

[The expression tree](/guide/the-tree) covers this toolkit — `evaluate`, `partialEval`, `rewrite`, building trees
without a lambda — and [Applications](/guide/applications) catalogs what it opens up. The rest of this page is
querying.

## Write a query

A context is the traced root. Property access on it (`db.users`) is a `Queryable`; every operator returns a new,
immutable query. Execution is explicit — `toArray()`, `first()`, `count()`, and so on.

```ts
import { createContext } from "@greffon/query";
import { memoryProvider } from "@greffon/provider-memory";

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
  .filter((u) => u.age >= 18 && u.active)
  .map((u) => ({ id: u.id, name: u.name }))
  .toArray();
// [{ id: 1, name: "Ada" }]
```

The full operator and executor surface — ordering, paging, `distinct`, aggregates, `explain()` — is in
[Queries & executors](/guide/queries); queries over more than one source — `join`, `leftJoin`, and
`include`/`thenInclude` over declared relations — are in [Joins & includes](/guide/joins-and-includes).

## The same query, on Postgres

Swap the provider. The query definitions do not change. The Postgres provider takes a driver `executor` — it works over
`pg`, `postgres.js`, Neon, or PGlite — and explicit schema metadata.

```ts
import { postgres } from "@greffon/provider-postgres";

const db = createContext<{ users: User }>(
  postgres(executor, { users: { table: "users" } }),
);

await db.users.filter((u) => u.age >= 18 && u.active).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1 AND "users"."active")
```

Constants become bound `$n` parameters — values are never interpolated into the SQL string. Call `explain()` on any
query to see the text a provider would run. The SQLite provider (`@greffon/provider-sqlite`) is the same swap with a
SQLite `executor`. Executor wiring for the common drivers, column and JSON mapping, and the SQLite specifics are in
[SQL providers](/guide/sql-providers);
[`examples/vite-postgres`](https://github.com/PhenX/Greffon/tree/main/examples/vite-postgres) runs this
same-query-two-providers story as a CI test.

## Without the plugin

In-memory paths work with no plugin: the memory provider calls your compiled lambda directly and never needs the tree.
A remote provider does need the tree, so without the plugin it falls back to parsing `Function.prototype.toString()`.
That path is closure-blind: a lambda capturing a variable reports [R3002](/errors#R3002) naming the variable, rather
than returning a wrong result. Enable it with:

```ts
import "@greffon/fallback/register";
```

[`examples/no-plugin-fallback`](https://github.com/PhenX/Greffon/tree/main/examples/no-plugin-fallback) exercises
this degradation story as a CI test.

## Editor squiggles & lint

The subset validator that runs in the build also runs in your editor and in ESLint or oxlint, so an invalid lambda
gets the same coded message in all three places. Enabling the editor plugin and the lint rules takes two config
entries — [Editor & lint](/guide/editor-and-lint).

## Coming from somewhere else?

- From C#: LINQ and EF Core are this design's ancestors, and the concepts map one-to-one —
  [The C# lineage](/guide/lineage).
- From Prisma, Drizzle, Kysely, TypeORM, or MikroORM: Greffon is not an ORM, and the overlap is narrower than it
  looks — [Compared to ORMs & rules engines](/guide/comparison).
