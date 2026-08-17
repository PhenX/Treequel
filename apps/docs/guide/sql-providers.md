# SQL providers

Two SQL providers ship with Treequel — `@treequel/provider-postgres` and `@treequel/provider-sqlite` — over one shared
translator (`@treequel/sql-core`). Both are driver-agnostic: you hand them an `executor` function over whatever client
your app already uses, plus explicit schema metadata. Neither owns connections, pooling, transactions, or migrations —
that stays with your driver ([the deliberate non-goals](/guide/comparison#what-treequel-deliberately-does-not-do)).

Both providers are property-tested against the memory reference, so a query means the same thing in your tests and in
production. [`examples/vite-postgres`](https://github.com/PhenX/Treequel/tree/main/examples/vite-postgres) runs that
same-query story end to end as a CI test.

## The executor

An executor runs one parameterized statement and resolves the rows as plain objects:

```ts
type SqlExecutor = (text: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
```

Any client fits behind that shape. `pg` and PGlite already return `{ rows }`:

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executor: SqlExecutor = (text, values) => pool.query(text, values);
```

Clients that return a bare row array wrap in one line — postgres.js:
`(text, values) => sql.unsafe(text, values).then((rows) => ({ rows }))`; better-sqlite3 or `node:sqlite`:
`async (text, values) => ({ rows: db.prepare(text).all(...values) })`.

## Postgres

```sh
npm i @treequel/provider-postgres
```

```ts
import { createContext } from "@treequel/query";
import { postgres } from "@treequel/provider-postgres";

const db = createContext<{ users: User }>(
  postgres(executor, { users: { table: "users" } }),
);

await db.users.filter((u) => u.age >= 18 && u.active).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1 AND "users"."active")
```

Constants bind as `$n` parameters — values are never interpolated into the SQL string, and `%`, `_`, and `\` in
`startsWith`/`endsWith`/`includes` patterns are escaped before they reach `LIKE`. Batched `include` fetches use one
`WHERE key = ANY($1)` array parameter per navigation.

## SQLite

```sh
npm i @treequel/provider-sqlite
```

```ts
import { sqlite } from "@treequel/provider-sqlite";

const db = createContext<{ users: User }>(
  sqlite(executor, { users: { table: "users" } }),
);

await db.users.filter((u) => u.name.startsWith("A")).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."name" GLOB ?)
```

The SQLite dialect exists so results match the memory reference row for row:

- Positional `?` parameters.
- String matching compiles to case-sensitive `GLOB`, because `LIKE` is case-insensitive on SQLite and
  `String.prototype.startsWith` is not.
- Null ordering follows the shared rule (last ascending, first descending) via explicit `NULLS` clauses.
- SQLite has no boolean type — model boolean columns as `0`/`1`; bound booleans are coerced for you.
- Batched `include` fetches chunk into `IN (…)` lists under SQLite's bound-variable limit.

## Schema metadata

The second argument maps logical sources to physical tables. Column names pass through unchanged unless mapped:

```ts
const db = createContext<{ users: User }>(
  postgres(executor, {
    users: {
      table: "users",
      columns: { createdAt: "created_at" }, // logical → physical; unmapped names pass through
      json: ["profile"], // columns holding JSON documents
    },
  }),
);
```

- **`columns`** — the query side always uses your row-type names (`u.createdAt`); the emitted SQL uses the physical
  ones (`"users"."created_at"`). Map only what differs.
- **`json`** — declares columns whose values are JSON documents. One level of member access on a declared column
  compiles to text extraction: `u.profile.city` becomes `"users"."profile"->>'city'` (Postgres and SQLite both
  support the operator). Deep access on an undeclared column is a located [R2002](/errors#R2002) naming the column,
  not a guess.

`postgres()` and `sqlite()` also take an options argument; `name` renames the provider in error messages when one app
runs several instances.

## Seeing the SQL

`explain()` returns the exact statement a query would run — the compiled SQL plus one line per batched `include`
fetch — without touching the database:

```ts
await db.users.filter((u) => u.age >= minAge).explain();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1)
```

## Where to go next

- [The boundary rule](/guide/the-boundary-rule) — untranslatable queries fail fast; `inMemory()` is the explicit
  escape hatch, and dates deserve their own reading.
- [Queries & executors](/guide/queries) — the full operator surface these providers translate.
- [Writing a provider](/guide/writing-a-provider) — the protocol behind these two, for targets beyond SQL.
