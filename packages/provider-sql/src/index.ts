/**
 * `@treequel/provider-sql` — the shared SQL-translation core. Holds the
 * dialect-agnostic translator, the `SqlDialect` seam, and the provider builder
 * `makeSqlProvider`; the concrete Postgres and SQLite providers (and any
 * third-party dialect) are thin packages that supply a `SqlDialect` and call it.
 * Pipeline per plan: partial-eval every expr → translate with a dialect → emit
 * `{ text, values }` (constants become bound params, never interpolated).
 */
import {
  type AnyExpr,
  type PlanOp,
  type QueryPlan,
  type QueryProvider,
  capabilities,
} from "@treequel/linq";
import { type Node, TreequelError, partialEval } from "@treequel/core";
import { type SchemaMeta, type TableMeta } from "./schema.js";
import { TranslateContext, quoteIdent, translate } from "./translate.js";
import { type SqlDialect } from "./dialect.js";

export type { SchemaMeta, TableMeta } from "./schema.js";
export { TranslateContext, quoteIdent, translate } from "./translate.js";
export type { SqlDialect, StringMatch } from "./dialect.js";
export { escapeLike, escapeGlob } from "./dialect.js";
// Re-exported so dialect packages depend only on this core.
export type { QueryProvider } from "@treequel/linq";

/** A driver-agnostic query runner. */
export type SqlExecutor = (
  text: string,
  values: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface SqlProviderOptions {
  readonly name?: string;
}

const SUPPORTED_OPS = ["where", "select", "orderBy", "thenBy", "take", "skip", "distinct", "exec"];

interface Compiled {
  readonly text: string;
  readonly values: unknown[];
  readonly post: (rows: Array<Record<string, unknown>>) => unknown;
}

function fold(expr: AnyExpr): Node {
  return partialEval({ body: expr.body, scope: expr.scope });
}

interface SelectParts {
  table: string;
  alias: string;
  distinct: boolean;
  projection: string | null; // null → SELECT alias.*
  where: string[];
  orderBy: string[];
  limit: number | null;
  offset: number | null;
}

function renderSelect(p: SelectParts, dialect: SqlDialect, selectList?: string): string {
  const sel = selectList ?? p.projection ?? `${quoteIdent(p.alias)}.*`;
  let sql = `SELECT ${p.distinct ? "DISTINCT " : ""}${sel} FROM ${quoteIdent(p.table)} ${quoteIdent(p.alias)}`;
  if (p.where.length > 0) sql += ` WHERE ${p.where.join(" AND ")}`;
  if (p.orderBy.length > 0) sql += ` ORDER BY ${p.orderBy.join(", ")}`;
  if (p.limit !== null) sql += ` LIMIT ${p.limit}`;
  else if (p.offset !== null && dialect.offsetRequiresLimit) sql += ` LIMIT -1`;
  if (p.offset !== null) sql += ` OFFSET ${p.offset}`;
  return sql;
}

function buildProjection(body: Node, ctx: TranslateContext): { sql: string; scalar: boolean } {
  if (body.kind === "ObjectLit") {
    const cols = body.props.map((prop) => {
      if ("spread" in prop)
        ctx.fail("R2001", "Spread in a select projection is not supported (v1).");
      return `${translate(prop.value, ctx)} AS ${quoteIdent(prop.key)}`;
    });
    return { sql: cols.join(", "), scalar: false };
  }
  return { sql: `${translate(body, ctx)} AS "value"`, scalar: true };
}

function compile(plan: QueryPlan, schema: SchemaMeta, dialect: SqlDialect): Compiled {
  const meta: TableMeta | undefined = schema[plan.source];
  if (!meta) {
    throw new TreequelError("R2002", `No schema meta for source '${plan.source}'.`);
  }
  const alias = meta.table;
  const ctx = new TranslateContext(meta, alias, dialect);

  const parts: SelectParts = {
    table: meta.table,
    alias,
    distinct: false,
    projection: null,
    where: [],
    orderBy: [],
    limit: null,
    offset: null,
  };
  let scalar = false;
  let exec: Extract<PlanOp, { op: "exec" }> | null = null;

  for (const op of plan.ops) {
    switch (op.op) {
      case "where":
        parts.where.push(translate(fold(op.expr), ctx));
        break;
      case "select": {
        const proj = buildProjection(fold(op.expr), ctx);
        parts.projection = proj.sql;
        scalar = proj.scalar;
        break;
      }
      case "orderBy":
      case "thenBy":
        parts.orderBy.push(
          `${translate(fold(op.expr), ctx)} ${op.desc ? "DESC" : "ASC"}${dialect.nullsSuffix(op.desc)}`,
        );
        break;
      case "take":
        parts.limit = op.n;
        break;
      case "skip":
        parts.offset = op.n;
        break;
      case "distinct":
        parts.distinct = true;
        break;
      case "exec":
        exec = op;
        break;
      default:
        throw new TreequelError(
          "R2001",
          `${dialect.name} provider does not support op '${op.op}' (v1).`,
        );
    }
  }

  const mapRow = (r: Record<string, unknown>): unknown => (scalar ? r.value : r);
  const kind = exec?.kind ?? "toArray";

  switch (kind) {
    case "toArray":
      return {
        text: renderSelect(parts, dialect),
        values: ctx.values,
        post: (rows) => rows.map(mapRow),
      };

    case "first":
    case "single": {
      if (exec?.expr) parts.where.push(translate(fold(exec.expr), ctx));
      parts.limit = kind === "first" ? 1 : 2;
      return {
        text: renderSelect(parts, dialect),
        values: ctx.values,
        post: (rows) => {
          if (kind === "single" && rows.length > 1) {
            throw new Error("Treequel: single() found more than one element.");
          }
          if (rows.length === 0) {
            if (exec?.orNull) return null;
            throw new Error(`Treequel: ${kind}() found no element.`);
          }
          return mapRow(rows[0] as Record<string, unknown>);
        },
      };
    }

    case "count": {
      if (exec?.expr) parts.where.push(translate(fold(exec.expr), ctx));
      const inner = renderSelect(parts, dialect, "1");
      return {
        text: `SELECT ${dialect.floatCast("COUNT(*)")} AS value FROM (${inner}) _t`,
        values: ctx.values,
        post: (rows) => Number(rows[0]?.value ?? 0),
      };
    }

    case "any": {
      if (exec?.expr) parts.where.push(translate(fold(exec.expr), ctx));
      const inner = renderSelect(parts, dialect, "1");
      return {
        text: `SELECT EXISTS(${inner}) AS value`,
        values: ctx.values,
        post: (rows) => Boolean(rows[0]?.value),
      };
    }

    case "all": {
      // ∀ p  ≡  ¬∃ ¬p
      if (exec?.expr) parts.where.push(`(NOT ${translate(fold(exec.expr), ctx)})`);
      const inner = renderSelect(parts, dialect, "1");
      return {
        text: `SELECT NOT EXISTS(${inner}) AS value`,
        values: ctx.values,
        post: (rows) => Boolean(rows[0]?.value),
      };
    }

    case "sum":
    case "min":
    case "max":
    case "avg": {
      const selector = translate(fold(exec?.expr as AnyExpr), ctx);
      const inner = renderSelect(parts, dialect, `${selector} AS v`);
      const agg =
        kind === "sum"
          ? dialect.floatCast("COALESCE(SUM(v), 0)")
          : kind === "avg"
            ? dialect.floatCast("AVG(v)")
            : `${kind.toUpperCase()}(v)`;
      return {
        text: `SELECT ${agg} AS value FROM (${inner}) _t`,
        values: ctx.values,
        post: (rows) => {
          const v = rows[0]?.value;
          if (v === null || v === undefined) return kind === "sum" ? 0 : null;
          return Number(v);
        },
      };
    }
  }
}

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
      const { text, values, post } = compile(plan, schema, dialect);
      const result = await executor(
        text,
        values.map((v) => dialect.coerceValue(v)),
      );
      return post(result.rows) as T;
    },
    async explain(plan: QueryPlan): Promise<string> {
      return compile(plan, schema, dialect).text;
    },
  };
}
