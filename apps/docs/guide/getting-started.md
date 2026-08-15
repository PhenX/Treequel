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

## The same query, on Postgres

Swap the provider. The query definitions do not change. The SQL provider takes a driver `executor` — it works over
`pg`, `postgres.js`, Neon, or PGlite — and explicit schema metadata.

```ts
import { sqlProvider } from "@treequel/provider-sql";

const db = createContext<{ users: User }>(
  sqlProvider(executor, { users: { table: "users" } }),
);

await db.users.where((u) => u.age >= 18 && u.active).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1 AND "users"."active")
```

Constants become bound `$n` parameters — values are never interpolated into the SQL string. Call `explain()` on any
query to see the text a provider would run.

## The same query, on SQLite

`sqliteProvider` is the same story with a SQLite `executor` (`better-sqlite3`, `node:sqlite`, sql.js, …). It emits
positional `?` parameters, case-sensitive `GLOB` matching, and Postgres-style null ordering, so its results match the
memory reference row for row.

```ts
import { sqliteProvider } from "@treequel/provider-sql";

const db = createContext<{ users: User }>(
  sqliteProvider(executor, { users: { table: "users" } }),
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
