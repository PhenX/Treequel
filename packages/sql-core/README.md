# @greffon/sql-core

The shared SQL-translation core of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: the
dialect-agnostic tree→SQL translator, the `SqlDialect` seam, and the `makeSqlProvider` builder behind
[`@greffon/provider-postgres`](https://github.com/PhenX/Greffon/tree/main/packages/provider-postgres) and
[`@greffon/provider-sqlite`](https://github.com/PhenX/Greffon/tree/main/packages/provider-sqlite).

Install this package to write a SQL provider for another dialect. To query Postgres or SQLite, install the provider
package instead — this core is an implementation detail behind both.

## Install

```
npm install @greffon/sql-core
```

## Usage

A dialect package supplies one `SqlDialect` object and calls `makeSqlProvider`. Beyond its dialect object and an
options pass-through, `@greffon/provider-postgres` is this:

```ts
import { type QueryProvider, type SchemaMeta, type SqlExecutor, makeSqlProvider } from "@greffon/sql-core";
import { pgDialect } from "./dialect.js";

export function postgres(executor: SqlExecutor, schema: SchemaMeta): QueryProvider {
  return makeSqlProvider(pgDialect, "postgres", executor, schema);
}
```

The dialect answers what differs between databases — placeholder style (`$1` vs `?`), string matching, date-field
extraction, array membership, float casts, exponentiation, null ordering, value coercion, and three flags
(`offsetRequiresLimit`, `maxBatchKeys`, `windowFunctions`: without window functions, per-parent include slices are
refused instead of miscompiled). The rest is shared: layered compilation with derived-table wrapping, split-query
includes, grouped aggregates, and correlated `EXISTS` subqueries for navigation predicates. Prove a dialect with
`runConformance` from `@greffon/query/testing`; the in-memory provider defines the behavior yours must match.

## API

- `SqlDialect` (with `StringMatch`, `DatePart`): the seam described above, one implementation per target database.
- `makeSqlProvider(dialect, defaultName, executor, schema, options?)`: assembles a `QueryProvider` — compiles each
  plan, binds constants as parameters, runs statements through the executor, stitches includes, answers `explain()`.
- `SqlExecutor`: `(text, values) => Promise<{ rows }>` — the driver-agnostic runner a provider is built over.
- `SchemaMeta` / `TableMeta` / `physicalColumn`: explicit logical→physical table, column, and JSON-column metadata.
- `translate`: the recursive tree→SQL walk; it refuses what a dialect cannot emit with a coded `R2001`, never a guess.
- `TranslateContext` / `TranslateEnv` / `ColumnShape` / `SCALAR_COLUMN`, with `shapeColumn`, `finalizeSql`, and
  `quoteIdent`: per-statement state — parameter markers, table aliases, and how each lambda parameter maps to columns.
- `escapeLike` / `escapeGlob`: escape pattern metacharacters so string matches stay literal.
- `QueryProvider`: re-exported from `@greffon/query` so a dialect package depends on this core alone.

## Docs

- [Writing a provider](https://phenx.github.io/Greffon/guide/writing-a-provider)
- [SQL providers](https://phenx.github.io/Greffon/guide/sql-providers)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
