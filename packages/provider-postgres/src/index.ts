/**
 * `@treequel/provider-postgres` — compiles a query plan to parameterized
 * Postgres over the shared `@treequel/provider-sql` translator. Driver-agnostic:
 * supply an `executor` over `pg`, `postgres.js`, Neon, or PGlite.
 */
import {
  type QueryProvider,
  type SchemaMeta,
  type SqlExecutor,
  type SqlProviderOptions,
  makeSqlProvider,
} from "@treequel/provider-sql";
import { pgDialect } from "./dialect.js";

export { pgDialect } from "./dialect.js";
export type {
  SchemaMeta,
  TableMeta,
  SqlExecutor,
  SqlProviderOptions,
} from "@treequel/provider-sql";

/** Build a Postgres provider from a driver executor and schema metadata. */
export function postgres(
  executor: SqlExecutor,
  schema: SchemaMeta,
  options: SqlProviderOptions = {},
): QueryProvider {
  return makeSqlProvider(pgDialect, "postgres", executor, schema, options);
}
