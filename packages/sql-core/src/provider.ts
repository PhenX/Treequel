/**
 * Assemble a {@link QueryProvider} from a {@link SqlDialect}, a driver
 * `executor`, and schema metadata. {@link makeSqlProvider} is what the concrete
 * dialect packages (and any third-party dialect) call: it compiles each plan,
 * runs it through the executor, and stitches any includes.
 */
import { type QueryPlan, type QueryProvider, capabilities } from "@treequel/linq";
import { compile } from "./compile.js";
import type { SqlDialect } from "./dialect.js";
import { type SqlExecutor, explainIncludes, stitchIncludes } from "./include-sql.js";
import type { SchemaMeta } from "./schema.js";

export interface SqlProviderOptions {
  readonly name?: string;
}

const SUPPORTED_OPS = [
  "where",
  "select",
  "orderBy",
  "thenBy",
  "take",
  "skip",
  "distinct",
  "join",
  "leftJoin",
  "include",
  "flatMap",
  "groupBy",
  "exec",
];

/**
 * Build a `QueryProvider` from a `SqlDialect`, a driver `executor`, and schema
 * metadata. The concrete provider packages (and third-party dialects) call this
 * with their dialect; `defaultName` names the provider unless `options.name`
 * overrides it.
 */
export function makeSqlProvider(
  dialect: SqlDialect,
  defaultName: string,
  executor: SqlExecutor,
  schema: SchemaMeta,
  options: SqlProviderOptions = {},
): QueryProvider {
  return {
    name: options.name ?? defaultName,
    capabilities() {
      return capabilities(SUPPORTED_OPS);
    },
    async execute<T>(plan: QueryPlan): Promise<T> {
      const { text, values, post, rowKind, includes, keyProp } = compile(plan, schema, dialect);
      const result = await executor(
        text,
        values.map((v) => dialect.coerceValue(v)),
      );
      const out = post(result.rows);
      if (includes.length === 0 || rowKind === null) return out as T;
      const parents = rowKind === "toArray" ? (out as unknown[]) : out === null ? [] : [out];
      const stitched = await stitchIncludes(
        parents,
        includes,
        keyProp,
        schema,
        dialect,
        executor,
        plan.relations,
      );
      return (rowKind === "toArray" ? stitched : (stitched[0] ?? null)) as T;
    },
    async explain(plan: QueryPlan): Promise<string> {
      const { text, includes } = compile(plan, schema, dialect);
      return text + explainIncludes(includes, schema);
    },
  };
}
