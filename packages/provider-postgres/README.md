# @greffon/provider-postgres

The Postgres provider of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: it compiles
query plans to parameterized Postgres SQL over the shared translator in
[`@greffon/sql-core`](https://github.com/PhenX/Greffon/tree/main/packages/sql-core). Driver-agnostic: you hand it an
`executor` function over the client your app already uses (`pg`, postgres.js, Neon, or PGlite) plus explicit schema
metadata. It owns no connections, pooling, transactions, or migrations.

The same query file runs against fixture arrays on
[`@greffon/provider-memory`](https://github.com/PhenX/Greffon/tree/main/packages/provider-memory), the reference this
provider is property-tested against (the conformance corpus runs on PGlite in CI).

## Install

```
npm install @greffon/provider-postgres
```

## Usage

```ts
import { createContext } from "@greffon/query";
import { type SqlExecutor, postgres } from "@greffon/provider-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executor: SqlExecutor = (text, values) => pool.query(text, values);

const db = createContext<{ users: User }>(postgres(executor, { users: { table: "users" } }));

await db.users.filter((u) => u.age >= 18 && u.active).toArray();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1 AND "users"."active")
```

The schema argument maps logical sources to physical tables: `columns` maps only the names that differ
(`{ createdAt: "created_at" }`), and `json` declares columns whose one-level member access compiles to `->>'…'`
extraction. `explain()` returns the exact statement a query would run, without touching the database.

- Constants bind as `$n` parameters — values are never interpolated into the SQL string — and `%`, `_`, and `\` in
  `startsWith`/`endsWith`/`includes` patterns are escaped before they reach `LIKE`.
- `include`/`thenInclude` over declared relations run as split queries: one batched fetch per navigation
  (`WHERE key = ANY($1)`), stitched onto the parents in memory. `take`/`skip` apply to the parents alone.
- `getFullYear()`/`getMonth()`/`getDate()` on a timestamp column compile to `EXTRACT`, read in UTC; `getMonth()` stays
  0-based. Other `Date` methods are refused.
- An expression the dialect cannot translate fails before any I/O with a located, coded error (`R2001`) — never a
  silent client-side fallback. `.inMemory()` is the explicit boundary for a suffix that must run in JavaScript.

## API

- `postgres(executor, schema, options?)`: build the `QueryProvider`; `options.name` renames it in error messages.
- `pgDialect`: the `SqlDialect` implementation, exported for wrapping or reuse.
- Re-exported from `@greffon/sql-core`: `SchemaMeta`, `TableMeta`, `SqlExecutor`, `SqlProviderOptions`.

## Docs

- [SQL providers](https://phenx.github.io/Greffon/guide/sql-providers)
- [The boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
