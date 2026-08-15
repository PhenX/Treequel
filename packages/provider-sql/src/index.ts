/**
 * `@treequel/provider-sql` — the shared SQL-translation core. Holds the
 * dialect-agnostic translator, the `SqlDialect` seam, and the provider builder
 * `makeSqlProvider`; the concrete Postgres and SQLite providers (and any
 * third-party dialect) are thin packages that supply a `SqlDialect` and call it.
 *
 * A plan compiles to a stack of SELECT layers: each operator either extends the
 * current layer or, when SQL evaluation order would change the meaning (a
 * `where` over a projection, a `distinct` under a `take`, a join onto a
 * filtered layer), wraps it into a derived table and continues on top. Joins
 * become real `INNER/LEFT JOIN` clauses; `include` runs as split queries —
 * one batched fetch per navigation, stitched with the shared engine from
 * `@treequel/linq`, so no join duplication ever inflates the parent rows.
 */
import {
  type AnyExpr,
  type IncludeSpec,
  type PlanOp,
  type QueryPlan,
  type QueryProvider,
  type RelationsMeta,
  attachChildren,
  capabilities,
  collectIncludes,
  collectKeys,
} from "@treequel/linq";
import { type Node, TreequelError, partialEval } from "@treequel/core";
import { type SchemaMeta, type TableMeta, physicalColumn } from "./schema.js";
import {
  type ColumnShape,
  SCALAR_COLUMN,
  TranslateContext,
  finalizeSql,
  quoteIdent,
  shapeColumn,
  translate,
} from "./translate.js";
import { type SqlDialect } from "./dialect.js";

export type { SchemaMeta, TableMeta } from "./schema.js";
export { physicalColumn } from "./schema.js";
export {
  type ColumnShape,
  type TranslateEnv,
  SCALAR_COLUMN,
  TranslateContext,
  finalizeSql,
  quoteIdent,
  shapeColumn,
  translate,
} from "./translate.js";
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
  "exec",
];

function fold(expr: AnyExpr): Node {
  return partialEval({ body: expr.body, scope: expr.scope });
}

/**
 * One SELECT under construction. `shape` resolves the *input* row of the layer
 * (its FROM clause); once `projection` is set, later operators wrap the layer
 * so they see the projected row instead.
 */
interface Layer {
  from: string;
  shape: ColumnShape;
  where: string[];
  projection: string | null;
  projectionColumns: readonly string[] | null;
  scalar: boolean;
  distinct: boolean;
  orderBy: string[];
  limit: number | null;
  offset: number | null;
  pristine: boolean;
}

function selectList(layer: Layer): string {
  return layer.projection ?? `${quoteIdent(layer.shape.alias)}.*`;
}

class Compiler {
  private aliasN = 0;
  readonly ctx: TranslateContext;

  constructor(
    readonly schema: SchemaMeta,
    readonly dialect: SqlDialect,
    relations?: RelationsMeta,
  ) {
    // Bindings are supplied per expression via `scoped`; the root context
    // carries the statement's shared parameter values and the navigation env.
    this.ctx = new TranslateContext(dialect, new Map(), undefined, [], {
      ...(relations ? { relations } : {}),
      schema,
      alias: () => this.alias("s"),
    });
  }

  alias(prefix: string): string {
    return `${prefix}${this.aliasN++}`;
  }

  tableMeta(source: string): TableMeta {
    const meta = this.schema[source];
    if (!meta) throw new TreequelError("R2002", `No schema meta for source '${source}'.`);
    return meta;
  }

  freshLayer(source: string): Layer {
    const meta = this.tableMeta(source);
    const alias = this.alias("t");
    return {
      from: `${quoteIdent(meta.table)} ${quoteIdent(alias)}`,
      shape: { kind: "table", alias, meta, source },
      where: [],
      projection: null,
      projectionColumns: null,
      scalar: false,
      distinct: false,
      orderBy: [],
      limit: null,
      offset: null,
      pristine: true,
    };
  }

  render(layer: Layer, overrideSelect?: string): string {
    let sql = `SELECT ${layer.distinct ? "DISTINCT " : ""}${overrideSelect ?? selectList(layer)} FROM ${layer.from}`;
    if (layer.where.length > 0) sql += ` WHERE ${layer.where.join(" AND ")}`;
    if (layer.orderBy.length > 0) sql += ` ORDER BY ${layer.orderBy.join(", ")}`;
    if (layer.limit !== null) sql += ` LIMIT ${layer.limit}`;
    else if (layer.offset !== null && this.dialect.offsetRequiresLimit) sql += ` LIMIT -1`;
    if (layer.offset !== null) sql += ` OFFSET ${layer.offset}`;
    return sql;
  }

  /** Close `layer` into a derived table and start a fresh one over it. */
  wrap(layer: Layer): Layer {
    const alias = this.alias("d");
    const shape: ColumnShape =
      layer.projection === null
        ? { ...layer.shape, alias }
        : layer.scalar
          ? { kind: "scalar", alias }
          : { kind: "derived", alias, columns: layer.projectionColumns };
    return {
      from: `(${this.render(layer)}) ${quoteIdent(alias)}`,
      shape,
      where: [],
      projection: null,
      projectionColumns: null,
      scalar: layer.scalar,
      distinct: false,
      orderBy: [],
      limit: null,
      offset: null,
      pristine: false,
    };
  }

  /** Translate a 1-param expression with its parameter bound to `shape`. */
  translateWith(e: AnyExpr, shape: ColumnShape): string {
    const scope = new Map<string, ColumnShape>();
    if (e.params[0]) scope.set(e.params[0], shape);
    return translate(fold(e), this.ctx.scoped(scope));
  }

  private translate1(e: AnyExpr, layer: Layer): string {
    return this.translateWith(e, layer.shape);
  }

  foldWhere(layer: Layer, cond: (l: Layer) => string): Layer {
    if (
      layer.projection !== null ||
      layer.distinct ||
      layer.limit !== null ||
      layer.offset !== null
    ) {
      layer = this.wrap(layer);
    }
    layer.where.push(cond(layer));
    layer.pristine = false;
    return layer;
  }

  foldSelect(layer: Layer, e: AnyExpr): Layer {
    if (layer.projection !== null || layer.distinct) layer = this.wrap(layer);
    const scope = new Map<string, ColumnShape>();
    if (e.params[0]) scope.set(e.params[0], layer.shape);
    const proj = this.projection(fold(e), this.ctx.scoped(scope));
    layer.projection = proj.sql;
    layer.projectionColumns = proj.columns;
    layer.scalar = proj.scalar;
    layer.pristine = false;
    return layer;
  }

  foldOrderBy(layer: Layer, e: AnyExpr, desc: boolean): Layer {
    if (layer.limit !== null || layer.offset !== null) layer = this.wrap(layer);
    if (layer.projection !== null) {
      // Order by an output column of the projection when the key is a bare
      // member (SQL resolves output names in ORDER BY); otherwise wrap.
      const body = fold(e);
      const dir = `${desc ? "DESC" : "ASC"}${this.dialect.nullsSuffix(desc)}`;
      if (
        body.kind === "Member" &&
        body.object.kind === "Param" &&
        layer.projectionColumns?.includes(body.prop)
      ) {
        layer.orderBy.push(`${quoteIdent(body.prop)} ${dir}`);
        return layer;
      }
      if (layer.scalar && body.kind === "Param") {
        layer.orderBy.push(`${quoteIdent(SCALAR_COLUMN)} ${dir}`);
        return layer;
      }
      layer = this.wrap(layer);
    }
    layer.orderBy.push(
      `${this.translate1(e, layer)} ${desc ? "DESC" : "ASC"}${this.dialect.nullsSuffix(desc)}`,
    );
    layer.pristine = false;
    return layer;
  }

  foldDistinct(layer: Layer): Layer {
    if (layer.limit !== null || layer.offset !== null) layer = this.wrap(layer);
    layer.distinct = true;
    layer.pristine = false;
    return layer;
  }

  foldTake(layer: Layer, n: number): Layer {
    const m = Math.max(0, n);
    layer.limit = layer.limit === null ? m : Math.min(layer.limit, m);
    layer.pristine = false;
    return layer;
  }

  foldSkip(layer: Layer, n: number): Layer {
    const m = Math.max(0, n);
    if (layer.limit !== null) layer.limit = Math.max(0, layer.limit - m);
    layer.offset = (layer.offset ?? 0) + m;
    layer.pristine = false;
    return layer;
  }

  foldJoin(layer: Layer, op: Extract<PlanOp, { op: "join" | "leftJoin" }>): Layer {
    if (!layer.pristine) layer = this.dirtyJoinBase(layer);
    let inner = this.compilePlan(op.inner);
    if (!inner.pristine) inner = this.wrap(inner);
    const on = this.joinCondition(op.outerKey, layer.shape, op.innerKey, inner.shape);
    layer.from += ` ${op.op === "join" ? "INNER" : "LEFT"} JOIN ${inner.from} ON ${on}`;

    const scope = new Map<string, ColumnShape>();
    const result = op.result;
    if (result.params[0]) scope.set(result.params[0], layer.shape);
    if (result.params[1]) scope.set(result.params[1], inner.shape);
    const proj = this.projection(fold(result), this.ctx.scoped(scope));
    layer.projection = proj.sql;
    layer.projectionColumns = proj.columns;
    layer.scalar = proj.scalar;
    layer.pristine = false;
    return layer;
  }

  /** A join needs a plain FROM on the left: wrap anything already shaped. */
  private dirtyJoinBase(layer: Layer): Layer {
    return this.wrap(layer);
  }

  private joinCondition(
    outerKey: AnyExpr,
    outerShape: ColumnShape,
    innerKey: AnyExpr,
    innerShape: ColumnShape,
  ): string {
    const outerCtx = this.ctx.scoped(
      new Map(outerKey.params[0] ? [[outerKey.params[0], outerShape]] : []),
    );
    const innerCtx = this.ctx.scoped(
      new Map(innerKey.params[0] ? [[innerKey.params[0], innerShape]] : []),
    );
    const lb = fold(outerKey);
    const rb = fold(innerKey);
    // Composite keys: `{ a: …, b: … }` on both sides pairs up by property name.
    if (lb.kind === "ObjectLit" && rb.kind === "ObjectLit") {
      const plain = (n: Extract<Node, { kind: "ObjectLit" }>): Map<string, Node> | null => {
        const m = new Map<string, Node>();
        for (const p of n.props) {
          if ("spread" in p) return null;
          m.set(p.key, p.value);
        }
        return m;
      };
      const lm = plain(lb);
      const rm = plain(rb);
      if (!lm || !rm || lm.size !== rm.size || lm.size === 0) {
        throw new TreequelError("R2001", "Composite join keys must be plain object literals.");
      }
      const parts: string[] = [];
      for (const [key, lnode] of [...lm.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const rnode = rm.get(key);
        if (!rnode) {
          throw new TreequelError(
            "R2001",
            `Composite join keys must have the same properties (missing '${key}').`,
          );
        }
        parts.push(`${translate(lnode, outerCtx)} = ${translate(rnode, innerCtx)}`);
      }
      return `(${parts.join(" AND ")})`;
    }
    return `(${translate(lb, outerCtx)} = ${translate(rb, innerCtx)})`;
  }

  private projection(
    body: Node,
    ctx: TranslateContext,
  ): { sql: string; scalar: boolean; columns: readonly string[] | null } {
    if (body.kind === "ObjectLit") {
      const columns: string[] = [];
      const cols = body.props.map((prop) => {
        if ("spread" in prop)
          ctx.fail("R2001", "Spread in a select projection is not supported (v1).");
        columns.push(prop.key);
        return `${translate(prop.value, ctx)} AS ${quoteIdent(prop.key)}`;
      });
      return { sql: cols.join(", "), scalar: false, columns };
    }
    return {
      sql: `${translate(body, ctx)} AS ${quoteIdent(SCALAR_COLUMN)}`,
      scalar: true,
      columns: [SCALAR_COLUMN],
    };
  }

  /** Fold a plan's ops (a query position: no exec/include/inMemory inside). */
  compilePlan(plan: QueryPlan): Layer {
    let layer = this.freshLayer(plan.source);
    for (const op of plan.ops) {
      layer = this.foldOp(layer, op);
    }
    return layer;
  }

  foldOp(layer: Layer, op: PlanOp): Layer {
    switch (op.op) {
      case "where":
        return this.foldWhere(layer, (l) => this.translate1(op.expr, l));
      case "select":
        return this.foldSelect(layer, op.expr);
      case "orderBy":
      case "thenBy":
        return this.foldOrderBy(layer, op.expr, op.desc);
      case "take":
        return this.foldTake(layer, op.n);
      case "skip":
        return this.foldSkip(layer, op.n);
      case "distinct":
        return this.foldDistinct(layer);
      case "join":
      case "leftJoin":
        return this.foldJoin(layer, op);
      default:
        throw new TreequelError(
          "R2001",
          `${this.dialect.name} provider does not support op '${op.op}' here.`,
        );
    }
  }
}

interface Compiled {
  readonly text: string;
  readonly values: unknown[];
  readonly post: (rows: Array<Record<string, unknown>>) => unknown;
  /** Row-shaped results (`toArray`/`first`/`single`) can carry includes. */
  readonly rowKind: "toArray" | "one" | null;
  readonly includes: readonly IncludeSpec[];
  /** Maps a logical key property to its name on the result rows. */
  readonly keyProp: (logical: string) => string;
}

function compile(plan: QueryPlan, schema: SchemaMeta, dialect: SqlDialect): Compiled {
  const compiler = new Compiler(schema, dialect, plan.relations);
  const includes = collectIncludes(plan.ops);
  let exec: Extract<PlanOp, { op: "exec" }> | null = null;

  let layer = compiler.freshLayer(plan.source);
  for (const op of plan.ops) {
    if (op.op === "include") continue;
    if (op.op === "exec") {
      exec = op;
      continue;
    }
    layer = compiler.foldOp(layer, op);
  }

  const kind = exec?.kind ?? "toArray";
  const withPred = (negate = false): void => {
    if (exec?.expr) {
      const e = exec.expr;
      layer = compiler.foldWhere(layer, (l) => {
        const cond = compiler.translateWith(e, l.shape);
        return negate ? `(NOT ${cond})` : cond;
      });
    }
  };

  // Assembled after the exec is folded, so closures see the final layer.
  const emit = (
    rawText: string,
    post: Compiled["post"],
    rowKind: Compiled["rowKind"],
  ): Compiled => {
    const final = finalizeSql(rawText, compiler.ctx.values, dialect);
    const keyProp = (logical: string): string =>
      layer.shape.kind === "table" && layer.projection === null
        ? physicalColumn(layer.shape.meta, logical)
        : logical;
    return { text: final.text, values: final.values, post, rowKind, includes, keyProp };
  };
  const mapRow = (r: Record<string, unknown>): unknown => (layer.scalar ? r[SCALAR_COLUMN] : r);
  /** `SELECT 1` body for row-existence/count shells, unless shaping matters. */
  const innerSelect = (): string =>
    layer.projection === null && !layer.distinct
      ? compiler.render(layer, "1")
      : compiler.render(layer);

  switch (kind) {
    case "toArray":
      return emit(compiler.render(layer), (rows) => rows.map(mapRow), "toArray");

    case "first":
    case "single": {
      withPred();
      layer = compiler.foldTake(layer, kind === "first" ? 1 : 2);
      const orNull = exec?.orNull ?? false;
      return emit(
        compiler.render(layer),
        (rows) => {
          if (kind === "single" && rows.length > 1) {
            throw new Error("Treequel: single() found more than one element.");
          }
          if (rows.length === 0) {
            if (orNull) return null;
            throw new Error(`Treequel: ${kind}() found no element.`);
          }
          return mapRow(rows[0] as Record<string, unknown>);
        },
        "one",
      );
    }

    case "count": {
      withPred();
      return emit(
        `SELECT ${dialect.floatCast("COUNT(*)")} AS ${quoteIdent(SCALAR_COLUMN)} FROM (${innerSelect()}) ${quoteIdent(compiler.alias("d"))}`,
        (rows) => Number(rows[0]?.[SCALAR_COLUMN] ?? 0),
        null,
      );
    }

    case "some":
    case "every": {
      withPred(kind === "every"); // ∀p ≡ ¬∃¬p
      const not = kind === "every" ? "NOT " : "";
      return emit(
        `SELECT ${not}EXISTS(${innerSelect()}) AS ${quoteIdent(SCALAR_COLUMN)}`,
        (rows) => Boolean(rows[0]?.[SCALAR_COLUMN]),
        null,
      );
    }

    case "sum":
    case "min":
    case "max":
    case "avg": {
      const wrapped = compiler.wrap(layer);
      const selector = compiler.translateWith(exec?.expr as AnyExpr, wrapped.shape);
      const agg =
        kind === "sum"
          ? dialect.floatCast(`COALESCE(SUM(${selector}), 0)`)
          : kind === "avg"
            ? dialect.floatCast(`AVG(${selector})`)
            : `${kind.toUpperCase()}(${selector})`;
      return emit(
        `SELECT ${agg} AS ${quoteIdent(SCALAR_COLUMN)} FROM ${wrapped.from}`,
        (rows) => {
          const v = rows[0]?.[SCALAR_COLUMN];
          if (v === null || v === undefined) return kind === "sum" ? 0 : null;
          return Number(v);
        },
        null,
      );
    }
  }
}

/** Fetch and attach one level of navigations via batched split queries. */
async function stitchIncludes(
  parents: unknown[],
  specs: readonly IncludeSpec[],
  keyProp: (logical: string) => string,
  schema: SchemaMeta,
  dialect: SqlDialect,
  executor: SqlExecutor,
): Promise<unknown[]> {
  let cur = parents;
  for (const spec of specs) {
    if (cur.length === 0) break;
    const parentProp = keyProp(spec.from);
    const meta = schema[spec.target];
    if (!meta) throw new TreequelError("R2002", `No schema meta for source '${spec.target}'.`);
    const childProp = physicalColumn(meta, spec.to);
    const keys = collectKeys(cur, parentProp, spec.nav);
    let children: unknown[] = [];
    if (keys.length > 0) {
      const batch = dialect.maxBatchKeys ?? keys.length;
      for (let i = 0; i < keys.length; i += batch) {
        const chunk = keys.slice(i, i + batch);
        const shape: ColumnShape = { kind: "table", alias: "c", meta };
        const ctx = new TranslateContext(dialect, shape);
        const col = shapeColumn(shape, spec.to, ctx);
        const raw = `SELECT ${quoteIdent("c")}.* FROM ${quoteIdent(meta.table)} ${quoteIdent("c")} WHERE ${dialect.arrayContains(col, chunk, ctx)}`;
        const { text, values } = finalizeSql(raw, ctx.values, dialect);
        const result = await executor(
          text,
          values.map((v) => dialect.coerceValue(v)),
        );
        children.push(...result.rows);
      }
    }
    if (spec.children && spec.children.length > 0) {
      children = await stitchIncludes(
        children,
        spec.children,
        (logical) => physicalColumn(meta, logical),
        schema,
        dialect,
        executor,
      );
    }
    cur = attachChildren(cur, spec, children, parentProp, childProp);
  }
  return cur;
}

function explainIncludes(specs: readonly IncludeSpec[], schema: SchemaMeta, depth = 0): string {
  let out = "";
  for (const spec of specs) {
    const table = schema[spec.target]?.table ?? spec.target;
    out += `\n-- include ${"  ".repeat(depth)}${spec.nav}: batched SELECT FROM ${quoteIdent(table)} WHERE ${quoteIdent(physicalColumn(schema[spec.target] ?? { table }, spec.to))} IN (parent keys)`;
    if (spec.children) out += explainIncludes(spec.children, schema, depth + 1);
  }
  return out;
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
      const { text, values, post, rowKind, includes, keyProp } = compile(plan, schema, dialect);
      const result = await executor(
        text,
        values.map((v) => dialect.coerceValue(v)),
      );
      const out = post(result.rows);
      if (includes.length === 0 || rowKind === null) return out as T;
      const parents = rowKind === "toArray" ? (out as unknown[]) : out === null ? [] : [out];
      const stitched = await stitchIncludes(parents, includes, keyProp, schema, dialect, executor);
      return (rowKind === "toArray" ? stitched : (stitched[0] ?? null)) as T;
    },
    async explain(plan: QueryPlan): Promise<string> {
      const { text, includes } = compile(plan, schema, dialect);
      return text + explainIncludes(includes, schema);
    },
  };
}
