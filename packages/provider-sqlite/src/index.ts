/**
 * `@greffon/provider-sqlite` — compiles a query plan to parameterized SQLite
 * over the shared `@greffon/sql-core` translator. Emits positional `?`
 * parameters, case-sensitive `GLOB` matching, and Postgres-style null ordering,
 * so results match the memory reference provider. Driver-agnostic: supply an
 * `executor` over `better-sqlite3`, `node:sqlite`, sql.js, or similar. SQLite
 * has no boolean type, so model boolean columns as `0`/`1`.
 */
import {
  type QueryProvider,
  type SchemaMeta,
  type SqlExecutor,
  type SqlProviderOptions,
  makeSqlProvider,
} from "@greffon/sql-core";
import { sqliteDialect } from "./dialect.js";

export { sqliteDialect } from "./dialect.js";
export type { SchemaMeta, TableMeta, SqlExecutor, SqlProviderOptions } from "@greffon/sql-core";

/** Build a SQLite provider from a driver executor and schema metadata. */
export function sqlite(
  executor: SqlExecutor,
  schema: SchemaMeta,
  options: SqlProviderOptions = {},
): QueryProvider {
  return makeSqlProvider(sqliteDialect, "sqlite", executor, schema, options);
}
