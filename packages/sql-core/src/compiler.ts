/**
 * The layer-stack SELECT builder. A {@link Layer} is one SELECT under
 * construction; the {@link Compiler} folds each plan op into the current layer
 * or, when SQL evaluation order would change the meaning (a `where` over a
 * projection, a `distinct` under a `take`, a join onto a filtered layer), wraps
 * it into a derived table and continues on top. Joins become real JOIN clauses;
 * projections, groups and navigation subqueries render through {@link translate}.
 */
import { type Node, TreequelError, partialEval } from "@treequel/core";
import type { AnyExpr, PlanOp, QueryPlan, RelationsMeta } from "@treequel/query";
import {
  type ColumnShape,
  SCALAR_COLUMN,
  TranslateContext,
  quoteIdent,
  shapeColumn,
} from "./context.js";
import type { SqlDialect } from "./dialect.js";
import type { SchemaMeta, TableMeta } from "./schema.js";
import { translate } from "./translate.js";

function fold(expr: AnyExpr): Node {
  return partialEval({ body: expr.body, scope: expr.scope });
}

/** A layer's row shape — groups exist only inside projection scopes. */
export type RowShape = Exclude<ColumnShape, { kind: "group" }>;

/**
 * One SELECT under construction. `shape` resolves the *input* row of the layer
 * (its FROM clause); once `projection` is set, later operators wrap the layer
 * so they see the projected row instead.
 */
export interface Layer {
  from: string;
  shape: RowShape;
  where: string[];
  projection: string | null;
  projectionColumns: readonly string[] | null;
  scalar: boolean;
  distinct: boolean;
  orderBy: string[];
  limit: number | null;
  offset: number | null;
  pristine: boolean;
  /** Rendered `GROUP BY` expressions, set by `foldGroupBy`. */
  groupClause: readonly string[] | null;
  /** Group awaiting its projection: key parts + the pre-group row shape. */
  pendingGroup: {
    readonly keyParts: ReadonlyArray<{ readonly name: string | null; readonly sql: string }>;
    readonly item: ColumnShape;
  } | null;
}

function selectList(layer: Layer): string {
  return layer.projection ?? `${quoteIdent(layer.shape.alias)}.*`;
}

export class Compiler {
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
      groupClause: null,
      pendingGroup: null,
    };
  }

  render(layer: Layer, overrideSelect?: string): string {
    let sql = `SELECT ${layer.distinct ? "DISTINCT " : ""}${overrideSelect ?? selectList(layer)} FROM ${layer.from}`;
    if (layer.where.length > 0) sql += ` WHERE ${layer.where.join(" AND ")}`;
    if (layer.groupClause && layer.groupClause.length > 0) {
      sql += ` GROUP BY ${layer.groupClause.join(", ")}`;
    }
    if (layer.orderBy.length > 0) sql += ` ORDER BY ${layer.orderBy.join(", ")}`;
    if (layer.limit !== null) sql += ` LIMIT ${layer.limit}`;
    else if (layer.offset !== null && this.dialect.offsetRequiresLimit) sql += ` LIMIT -1`;
    if (layer.offset !== null) sql += ` OFFSET ${layer.offset}`;
    return sql;
  }

  /** A `groupBy` needs its projection before any other operator continues. */
  private rejectPendingGroup(layer: Layer, doing: string): void {
    if (layer.pendingGroup) {
      throw new TreequelError(
        "R2001",
        `groupBy must be followed by a map projection (${doing} over raw groups is memory-only in v1).`,
      );
    }
  }

  /** Close `layer` into a derived table and start a fresh one over it. */
  wrap(layer: Layer): Layer {
    this.rejectPendingGroup(layer, "wrap");
    const alias = this.alias("d");
    const shape: RowShape =
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
      groupClause: null,
      pendingGroup: null,
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
    this.rejectPendingGroup(layer, "filter");
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
    if (layer.pendingGroup) {
      const group = layer.pendingGroup;
      const scope = new Map<string, ColumnShape>();
      if (e.params[0]) {
        scope.set(e.params[0], { kind: "group", keyParts: group.keyParts, item: group.item });
      }
      const proj = this.projection(fold(e), this.ctx.scoped(scope));
      layer.projection = proj.sql;
      layer.projectionColumns = proj.columns;
      layer.scalar = proj.scalar;
      layer.pendingGroup = null;
      layer.pristine = false;
      return layer;
    }
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

  /**
   * Start a group: translate the key against the current row shape (composite
   * object keys contribute one expression per property) and hold the group
   * open until the projection arrives. Any key part that is not a bare column
   * is precomputed into a derived table first — a grouped SELECT cannot
   * re-evaluate expressions like correlated subqueries (Postgres refuses),
   * and precomputing evaluates them once per row. Aggregate lambdas translate
   * against a source-stripped item shape — navigations inside them are
   * refused rather than silently diverging from the reference.
   */
  foldGroupBy(layer: Layer, e: AnyExpr): Layer {
    this.rejectPendingGroup(layer, "groupBy");
    if (
      layer.projection !== null ||
      layer.distinct ||
      layer.orderBy.length > 0 ||
      layer.limit !== null ||
      layer.offset !== null
    ) {
      layer = this.wrap(layer);
    }
    const body = fold(e);
    const parts: Array<{ name: string | null; node: Node }> = [];
    if (body.kind === "ObjectLit") {
      for (const prop of body.props) {
        if ("spread" in prop) {
          throw new TreequelError("R2001", "Spread in a groupBy key is not supported.");
        }
        parts.push({ name: prop.key, node: prop.value });
      }
      if (parts.length === 0) {
        throw new TreequelError("R2001", "A composite groupBy key needs at least one property.");
      }
    } else {
      parts.push({ name: null, node: body });
    }

    const param = e.params[0];
    const isColumn = (n: Node): boolean => n.kind === "Member" && n.object.kind === "Param";
    const computed = new Map<number, string>();
    if (parts.some((p) => !isColumn(p.node))) {
      const scope = new Map<string, ColumnShape>();
      if (param) scope.set(param, layer.shape);
      const ctx = this.ctx.scoped(scope);
      const extras: string[] = [];
      parts.forEach((p, i) => {
        if (!isColumn(p.node)) {
          const col = `__tql_g${i}`;
          computed.set(i, col);
          extras.push(`${translate(p.node, ctx)} AS ${quoteIdent(col)}`);
        }
      });
      const star = `${quoteIdent(layer.shape.alias)}.*`;
      const inner = this.render(layer, `${star}, ${extras.join(", ")}`);
      const alias = this.alias("d");
      layer = {
        from: `(${inner}) ${quoteIdent(alias)}`,
        shape: { ...layer.shape, alias },
        where: [],
        projection: null,
        projectionColumns: null,
        scalar: false,
        distinct: false,
        orderBy: [],
        limit: null,
        offset: null,
        pristine: false,
        groupClause: null,
        pendingGroup: null,
      };
    }

    const scope = new Map<string, ColumnShape>();
    if (param) scope.set(param, layer.shape);
    const ctx = this.ctx.scoped(scope);
    const keyParts = parts.map((p, i) => {
      const col = computed.get(i);
      const sql =
        col === undefined
          ? translate(p.node, ctx)
          : `${quoteIdent(layer.shape.alias)}.${quoteIdent(col)}`;
      return { name: p.name, sql };
    });
    const item: ColumnShape =
      layer.shape.kind === "table" ? { ...layer.shape, source: undefined } : layer.shape;
    layer.groupClause = keyParts.map((k) => k.sql);
    layer.pendingGroup = { keyParts, item };
    layer.pristine = false;
    return layer;
  }

  foldOrderBy(layer: Layer, e: AnyExpr, desc: boolean): Layer {
    this.rejectPendingGroup(layer, "orderBy");
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
    this.rejectPendingGroup(layer, "distinct");
    if (layer.limit !== null || layer.offset !== null) layer = this.wrap(layer);
    layer.distinct = true;
    layer.pristine = false;
    return layer;
  }

  foldTake(layer: Layer, n: number): Layer {
    this.rejectPendingGroup(layer, "take");
    const m = Math.max(0, n);
    layer.limit = layer.limit === null ? m : Math.min(layer.limit, m);
    layer.pristine = false;
    return layer;
  }

  foldSkip(layer: Layer, n: number): Layer {
    this.rejectPendingGroup(layer, "skip");
    const m = Math.max(0, n);
    if (layer.limit !== null) layer.limit = Math.max(0, layer.limit - m);
    layer.offset = (layer.offset ?? 0) + m;
    layer.pristine = false;
    return layer;
  }

  foldJoin(layer: Layer, op: Extract<PlanOp, { op: "join" | "leftJoin" }>): Layer {
    this.rejectPendingGroup(layer, "join");
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

  /**
   * Expand rows through a navigation: an `INNER JOIN` onto the target table.
   * Without a result selector the element *becomes* the child row — the layer
   * swaps to the child's table shape (its navigations stay resolvable);
   * with one, the two-parameter projection shapes the pair like a join.
   */
  foldFlatMap(layer: Layer, op: Extract<PlanOp, { op: "flatMap" }>): Layer {
    this.rejectPendingGroup(layer, "flatMap");
    if (!layer.pristine) layer = this.wrap(layer);
    const child = this.freshLayer(op.target);
    const childShape = child.shape;
    const on = `(${shapeColumn(layer.shape, op.from, this.ctx)} = ${shapeColumn(childShape, op.to, this.ctx)})`;
    layer.from += ` INNER JOIN ${child.from} ON ${on}`;
    if (op.result) {
      const scope = new Map<string, ColumnShape>();
      if (op.result.params[0]) scope.set(op.result.params[0], layer.shape);
      if (op.result.params[1]) scope.set(op.result.params[1], childShape);
      const proj = this.projection(fold(op.result), this.ctx.scoped(scope));
      layer.projection = proj.sql;
      layer.projectionColumns = proj.columns;
      layer.scalar = proj.scalar;
    } else {
      layer.shape = childShape;
    }
    layer.pristine = false;
    return layer;
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
      case "filter":
        return this.foldWhere(layer, (l) => this.translate1(op.expr, l));
      case "map":
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
      case "groupBy":
        return this.foldGroupBy(layer, op.expr);
      case "join":
      case "leftJoin":
        return this.foldJoin(layer, op);
      case "flatMap":
        return this.foldFlatMap(layer, op);
      default:
        throw new TreequelError(
          "R2001",
          `${this.dialect.name} provider does not support op '${op.op}' here.`,
        );
    }
  }
}
