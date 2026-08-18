# @greffon/provider-sqlite

The SQLite provider of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: it compiles
query plans to parameterized SQLite over the shared translator in
[`@greffon/sql-core`](https://github.com/PhenX/Greffon/tree/main/packages/sql-core). Driver-agnostic: you hand it an
`executor` function over the client your app already uses (better-sqlite3, `node:sqlite`, or sql.js) plus explicit
schema metadata. It owns no connections, transactions, or migrations.

The same query file runs against fixture arrays on
[`@greffon/provider-memory`](https://github.com/PhenX/Greffon/tree/main/packages/provider-memory), the reference this
provider is property-tested against (the conformance corpus runs on sql.js in CI).

## Install

```
npm install @greffon/provider-sqlite
```

## Usage

```ts
import { createContext } from "@greffon/query";
import { type SqlExecutor, sqlite } from "@greffon/provider-sqlite";
import Database from "better-sqlite3";

const conn = new Database("app.db");
const executor: SqlExecutor = async (text, values) => ({ rows: conn.prepare(text).all(...values) });

const db = createContext<{ users: User }>(sqlite(executor, { users: { table: "users" } }));

await db.users.filter((u) => u.name.startsWith("A")).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."name" GLOB ?)
```

The `node:sqlite` built-in wires with the same one-liner. The schema argument maps logical sources to physical
tables: `columns` maps only the names that differ, and `json` declares columns whose one-level member access compiles
to `->>'…'` extraction. `explain()` returns the exact statement a query would run, without touching the database.

- Constants bind as positional `?` parameters — values are never interpolated into the SQL string. String matching
  compiles to case-sensitive `GLOB` (with `*`, `?`, `[` escaped), because `LIKE` is case-insensitive on SQLite and
  `String.prototype.startsWith` is not.
- Null ordering is stated explicitly (`NULLS LAST` ascending, `NULLS FIRST` descending), matching the shared rule.
- SQLite has no boolean or date type: model boolean columns as `0`/`1` (bound booleans are coerced), bound `Date`s
  bind as ISO-8601 UTC text, and `getFullYear()`/`getMonth()`/`getDate()` on a column compile to `strftime`, read in
  UTC with `getMonth()` staying 0-based. Other `Date` methods are refused.
- `include`/`thenInclude` over declared relations run as split queries: one batched fetch per navigation, chunked
  into `IN (…)` lists under SQLite's bound-variable limit, stitched onto the parents in memory.
- An expression the dialect cannot translate fails before any I/O with a located, coded error (`R2001`) — never a
  silent client-side fallback. `.inMemory()` is the explicit boundary for a suffix that must run in JavaScript.

## API

- `sqlite(executor, schema, options?)`: build the `QueryProvider`; `options.name` renames it in error messages.
- `sqliteDialect`: the `SqlDialect` implementation, exported for wrapping or reuse.
- Re-exported from `@greffon/sql-core`: `SchemaMeta`, `TableMeta`, `SqlExecutor`, `SqlProviderOptions`.

## Docs

- [SQL providers](https://phenx.github.io/Greffon/guide/sql-providers)
- [The boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
