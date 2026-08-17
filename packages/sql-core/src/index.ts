/**
 * `@treequel/sql-core` — the shared SQL-translation core. It holds the
 * dialect-agnostic translator, the `SqlDialect` seam, and the provider builder
 * `makeSqlProvider`; the concrete Postgres and SQLite providers (and any
 * third-party dialect) are thin packages that supply a `SqlDialect` and call it.
 *
 * Module layout:
 *  - `schema.ts` / `dialect.ts` — schema metadata and the dialect seam.
 *  - `context.ts` — the `TranslateContext`, `ColumnShape`, and SQL helpers.
 *  - `patterns.ts` — pure recognizers (navigation chains, group items, reduce idioms).
 *  - `translate.ts` — the recursive tree→SQL `translate`.
 *  - `compiler.ts` / `compile.ts` — the layer-stack builder and the plan→statement entry.
 *  - `include-sql.ts` — split-query `include` loading and `explain` rendering.
 *  - `provider.ts` — `makeSqlProvider`.
 */
export { type SchemaMeta, type TableMeta, physicalColumn } from "./schema.js";
export {
  type ColumnShape,
  type TranslateEnv,
  SCALAR_COLUMN,
  TranslateContext,
  finalizeSql,
  quoteIdent,
  shapeColumn,
} from "./context.js";
export { translate } from "./translate.js";
export {
  type SqlDialect,
  type StringMatch,
  type DatePart,
  escapeLike,
  escapeGlob,
} from "./dialect.js";
export type { SqlExecutor } from "./include-sql.js";
export { type SqlProviderOptions, makeSqlProvider } from "./provider.js";
// Re-exported so dialect packages depend only on this core.
export type { QueryProvider } from "@treequel/query";
