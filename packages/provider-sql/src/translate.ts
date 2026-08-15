import { type Node, TreequelError } from "@treequel/core";
import type { Relation, RelationsMeta } from "@treequel/linq";
import { type SchemaMeta, type TableMeta, physicalColumn } from "./schema.js";
import { type SqlDialect } from "./dialect.js";

/**
 * How a lambda parameter resolves to SQL. A `table` shape maps properties
 * through schema meta to physical columns (`source` is its logical source
 * name, for navigation lookup); a `derived` shape maps them to the output
 * aliases of a subquery projection; a `scalar` shape is a single-value row
 * (`SELECT expr AS "value"`) whose parameter *is* the value.
 */
export type ColumnShape =
  | {
      readonly kind: "table";
      readonly alias: string;
      readonly meta: TableMeta;
      readonly source?: string;
    }
  | { readonly kind: "derived"; readonly alias: string; readonly columns: readonly string[] | null }
  | { readonly kind: "scalar"; readonly alias: string };

/** Statement-wide surroundings for navigation subqueries (`EXISTS`). */
export interface TranslateEnv {
  readonly relations?: RelationsMeta;
  readonly schema?: SchemaMeta;
  /** Allocate a statement-unique table alias. */
  readonly alias?: () => string;
}

/** Column name a scalar subquery projects its value under. */
export const SCALAR_COLUMN = "value";

// NUL delimits value markers: it cannot appear in generated SQL text, so a
// marker never collides with identifiers, keywords, or literals.
const NUL = String.fromCharCode(0);
const MARKER = new RegExp(`${NUL}(\\d+)${NUL}`, "g");

/**
 * State threaded through a single SQL statement's translation. `param()` emits
 * a position-independent marker; {@link finalizeSql} rewrites markers to the
 * dialect's placeholders in *textual* order and reorders the values to match —
 * translation order and clause order are free to differ (they do: a `WHERE`
 * folds before the `SELECT` list that precedes it in the statement).
 */
export class TranslateContext {
  readonly values: unknown[];
  readonly env: TranslateEnv;
  private readonly shapes: ReadonlyMap<string, ColumnShape> | ColumnShape;
  private readonly parent?: TranslateContext;

  constructor(
    readonly dialect: SqlDialect,
    shapes: ReadonlyMap<string, ColumnShape> | ColumnShape,
    readonly loc?: string,
    values: unknown[] = [],
    env: TranslateEnv = {},
    parent?: TranslateContext,
  ) {
    this.shapes = shapes;
    this.values = values;
    this.env = env;
    this.parent = parent;
  }

  /**
   * A context over new parameter bindings that shares this statement's values
   * and env. The current bindings stay visible as the lexical parent scope, so
   * a nested navigation lambda can still reference the outer row.
   */
  scoped(shapes: ReadonlyMap<string, ColumnShape> | ColumnShape): TranslateContext {
    return new TranslateContext(this.dialect, shapes, this.loc, this.values, this.env, this);
  }

  /** Resolve a lambda parameter. A single (non-map) shape binds every parameter. */
  shapeOf(param: string): ColumnShape | undefined {
    if (this.shapes instanceof Map) {
      return this.shapes.get(param) ?? this.parent?.shapeOf(param);
    }
    return this.shapes as ColumnShape;
  }

  param(value: unknown): string {
    this.values.push(value);
    return `${NUL}${this.values.length - 1}${NUL}`;
  }

  private located(detail: string): string {
    return this.loc ? `${detail} (${this.loc})` : detail;
  }

  fail(code: string, detail: string): never {
    throw new TreequelError(code, this.located(detail));
  }
}

/** Rewrite param markers to dialect placeholders in textual order. */
export function finalizeSql(
  text: string,
  values: readonly unknown[],
  dialect: SqlDialect,
): { text: string; values: unknown[] } {
  const ordered: unknown[] = [];
  const finalText = text.replace(MARKER, (_m, index: string) => {
    ordered.push(values[Number(index)]);
    return dialect.placeholder(ordered.length);
  });
  return { text: finalText, values: ordered };
}

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Column reference for `prop` on rows of the given shape. */
export function shapeColumn(shape: ColumnShape, prop: string, ctx: TranslateContext): string {
  switch (shape.kind) {
    case "table":
      return `${quoteIdent(shape.alias)}.${quoteIdent(physicalColumn(shape.meta, prop))}`;
    case "derived":
      if (shape.columns && !shape.columns.includes(prop)) {
        return ctx.fail("R2002", `Column '${prop}' is not part of the projected row.`);
      }
      return `${quoteIdent(shape.alias)}.${quoteIdent(prop)}`;
    case "scalar":
      return ctx.fail("R2002", `A scalar row has no column '${prop}'.`);
  }
}

const NUMERIC_BINARY: Record<string, string> = {
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "%": "%",
};

function isNullConstant(n: Node): boolean {
  return n.kind === "Constant" && n.value === null;
}

/** Translate a (partial-evaluated, param-rooted) tree to a SQL fragment. */
export function translate(node: Node, ctx: TranslateContext): string {
  switch (node.kind) {
    case "Constant":
      return node.value === null ? "NULL" : ctx.param(node.value);

    case "Param": {
      const shape = ctx.shapeOf(node.name);
      if (shape?.kind === "scalar") {
        return `${quoteIdent(shape.alias)}.${quoteIdent(SCALAR_COLUMN)}`;
      }
      return ctx.fail("R2001", "Bare row reference is not translatable; project specific columns.");
    }

    case "Capture":
      return ctx.fail(
        "R2005",
        `Unresolved capture '${node.name}' survived partial evaluation (a Param-dependent captured function?).`,
      );

    case "Member":
      return translateMember(node, ctx);

    case "Index":
      return ctx.fail("R2002", "Dynamic index access is not translatable to a column.");

    case "Binary":
      return translateBinary(node, ctx);

    case "Logical": {
      const left = translate(node.left, ctx);
      const right = translate(node.right, ctx);
      if (node.op === "&&") return `(${left} AND ${right})`;
      if (node.op === "||") return `(${left} OR ${right})`;
      return `COALESCE(${left}, ${right})`; // ??
    }

    case "Unary": {
      if (node.op === "!") return `(NOT ${translate(node.operand, ctx)})`;
      if (node.op === "-") return `(-${translate(node.operand, ctx)})`;
      if (node.op === "+") return `(+${translate(node.operand, ctx)})`;
      return ctx.fail("R2001", "typeof is not translatable to SQL.");
    }

    case "Ternary":
      return `CASE WHEN ${translate(node.test, ctx)} THEN ${translate(node.then, ctx)} ELSE ${translate(node.else, ctx)} END`;

    case "Call":
      return translateCall(node, ctx);

    case "In":
      return translateIn(node.needle, node.haystack, ctx);

    case "Template":
      return translateTemplate(node, ctx);

    default:
      return ctx.fail("R2001", `Cannot translate node of kind '${node.kind}'.`);
  }
}

function paramShape(node: Node, ctx: TranslateContext): ColumnShape {
  const shape = ctx.shapeOf((node as Extract<Node, { kind: "Param" }>).name);
  if (!shape) {
    return ctx.fail(
      "R2002",
      `Lambda parameter '${(node as Extract<Node, { kind: "Param" }>).name}' is not bound to a table here.`,
    );
  }
  return shape;
}

function translateMember(node: Extract<Node, { kind: "Member" }>, ctx: TranslateContext): string {
  // Navigation count / string length
  if (node.prop === "length") {
    const chain = matchNavChain(node.object, ctx);
    if (chain) {
      return navSubquery(chain, ctx, (d) => d.floatCast("COUNT(*)"));
    }
    return `LENGTH(${translate(node.object, ctx)})`;
  }
  // Direct column: Member(Param, col)
  if (node.object.kind === "Param") {
    return shapeColumn(paramShape(node.object, ctx), node.prop, ctx);
  }
  // One level of JSONB path: Member(Member(Param, jsonCol), key)
  if (node.object.kind === "Member" && node.object.object.kind === "Param") {
    const shape = paramShape(node.object.object, ctx);
    const col = node.object.prop;
    if (shape.kind === "table" && shape.meta.json?.includes(col)) {
      return `${quoteIdent(shape.alias)}.${quoteIdent(physicalColumn(shape.meta, col))}->>'${node.prop.replace(/'/g, "''")}'`;
    }
    return ctx.fail(
      "R2002",
      `Deep member '.${node.prop}' requires column '${col}' to be declared json in schema meta.`,
    );
  }
  return ctx.fail("R2002", `Unresolvable member path '.${node.prop}'.`);
}

function translateBinary(node: Extract<Node, { kind: "Binary" }>, ctx: TranslateContext): string {
  // null comparison normalization
  if (node.op === "===" || node.op === "!==") {
    const isNot = node.op === "!==";
    if (isNullConstant(node.right)) {
      return `(${translate(node.left, ctx)} IS ${isNot ? "NOT " : ""}NULL)`;
    }
    if (isNullConstant(node.left)) {
      return `(${translate(node.right, ctx)} IS ${isNot ? "NOT " : ""}NULL)`;
    }
    return `(${translate(node.left, ctx)} ${isNot ? "<>" : "="} ${translate(node.right, ctx)})`;
  }
  if (node.op === "**") {
    return ctx.dialect.power(translate(node.left, ctx), translate(node.right, ctx));
  }
  if (node.op === "in") {
    return translateIn(node.left, node.right, ctx);
  }
  const sqlOp = NUMERIC_BINARY[node.op];
  if (!sqlOp) return ctx.fail("R2001", `Operator '${node.op}' is not translatable.`);
  return `(${translate(node.left, ctx)} ${sqlOp} ${translate(node.right, ctx)})`;
}

function translateCall(node: Extract<Node, { kind: "Call" }>, ctx: TranslateContext): string {
  if (node.callee.kind !== "Member") {
    return ctx.fail("R2001", "Only method calls are translatable.");
  }
  const method = node.callee.prop;
  const recv = node.callee.object;
  const args = node.args;

  switch (method) {
    case "some":
    case "every":
      return translateNavQuantifier(method, recv, args, ctx);
    case "reduce":
      return translateNavReduce(recv, args, ctx);
    case "startsWith":
    case "endsWith":
    case "includes":
      return translateLike(method, recv, args, ctx);
    case "toLowerCase":
      return `LOWER(${translate(recv, ctx)})`;
    case "toUpperCase":
      return `UPPER(${translate(recv, ctx)})`;
    case "trim":
      return `TRIM(${translate(recv, ctx)})`;
    case "abs":
    case "floor":
    case "ceil":
    case "round": {
      // Math.<fn>(x) — recv is the Math global capture; arg is the value.
      const fn = method === "ceil" ? "CEIL" : method.toUpperCase();
      return `${fn}(${translate(args[0] as Node, ctx)})`;
    }
    default:
      return ctx.fail(
        "R2001",
        `Call '.${method}()' is not translatable by the ${ctx.dialect.name} provider — cross the .inMemory() boundary or extend the dialect.`,
      );
  }
}

/**
 * A navigation reference inside an expression: `param.nav`, optionally
 * extended by `.filter(l)` steps, resolved against the outer row's shape.
 */
interface NavChain {
  readonly rel: Relation;
  readonly outer: Extract<ColumnShape, { kind: "table" }>;
  readonly filters: ReadonlyArray<Extract<Node, { kind: "Lambda" }>>;
}

function matchNavChain(n: Node, ctx: TranslateContext): NavChain | null {
  if (n.kind === "Member" && n.object.kind === "Param") {
    const shape = ctx.shapeOf(n.object.name);
    if (shape?.kind !== "table" || shape.source === undefined) return null;
    const rel = ctx.env.relations?.[shape.source]?.[n.prop];
    return rel ? { rel, outer: shape, filters: [] } : null;
  }
  if (
    n.kind === "Call" &&
    n.callee.kind === "Member" &&
    n.callee.prop === "filter" &&
    n.args[0]?.kind === "Lambda"
  ) {
    const base = matchNavChain(n.callee.object, ctx);
    if (!base) return null;
    return { ...base, filters: [...base.filters, n.args[0]] };
  }
  return null;
}

/**
 * `(SELECT <agg> FROM child WHERE key AND filters…)` for a navigation chain.
 * Each nested lambda translates in a child scope whose lexical parent is the
 * current scope, so inner predicates can still reference the outer row.
 */
function navSubquery(
  chain: NavChain,
  ctx: TranslateContext,
  selectFor: (dialect: SqlDialect, childCtx: TranslateContext, childShape: ColumnShape) => string,
  extraCond?: (childCtx: TranslateContext, childShape: ColumnShape) => string,
): string {
  const { schema, alias } = ctx.env;
  if (!schema || !alias) {
    return ctx.fail("R2001", "Navigation subqueries need schema metadata on the translate env.");
  }
  const childMeta = schema[chain.rel.target];
  if (!childMeta) {
    return ctx.fail("R2002", `No schema meta for source '${chain.rel.target}'.`);
  }
  const childAlias = alias();
  const childShape: ColumnShape = {
    kind: "table",
    alias: childAlias,
    meta: childMeta,
    source: chain.rel.target,
  };
  const conds = [
    `${shapeColumn(childShape, chain.rel.to, ctx)} = ${shapeColumn(chain.outer, chain.rel.from, ctx)}`,
  ];
  for (const f of chain.filters) {
    const inner = ctx.scoped(new Map([[f.params[0] as string, childShape]]));
    conds.push(`(${translate(f.body, inner)})`);
  }
  if (extraCond) conds.push(extraCond(ctx, childShape));
  const sel = selectFor(ctx.dialect, ctx, childShape);
  return `(SELECT ${sel} FROM ${quoteIdent(childMeta.table)} ${quoteIdent(childAlias)} WHERE ${conds.join(" AND ")})`;
}

/**
 * `parent.nav.some(c => …)` → `EXISTS (SELECT 1 FROM child WHERE key AND …)`;
 * `every` → `NOT EXISTS (… AND NOT …)`, which is vacuously true over an empty
 * navigation, matching `Array.prototype.every`. Filter steps in the chain
 * (`nav.filter(p).every(q)`) stay positive conditions; only the quantifier's
 * own predicate negates.
 */
function translateNavQuantifier(
  method: "some" | "every",
  recv: Node,
  args: readonly Node[],
  ctx: TranslateContext,
): string {
  const chain = matchNavChain(recv, ctx);
  if (!chain) {
    return ctx.fail(
      "R2001",
      `.${method}() translates only over a declared navigation collection (\`u.orders?.${method}(…)\`) — check the relations map on the context.`,
    );
  }
  const lambda = args[0];
  if (lambda?.kind !== "Lambda" || lambda.params.length === 0) {
    return ctx.fail("R2001", `.${method}() over a navigation requires an inline predicate lambda.`);
  }
  const exists = navSubquery(
    chain,
    ctx,
    () => "1",
    (childCtx, childShape) => {
      const inner = childCtx.scoped(new Map([[lambda.params[0] as string, childShape]]));
      const body = translate(lambda.body, inner);
      return method === "some" ? `(${body})` : `(NOT (${body}))`;
    },
  );
  return method === "some" ? `EXISTS ${exists}` : `NOT EXISTS ${exists}`;
}

/**
 * The recognized JS sum idiom over a navigation:
 * `nav.reduce((acc, o) => acc + expr, init)` with a constant numeric `init` →
 * `(init +) COALESCE((SELECT SUM(expr) FROM child WHERE key…), 0)`.
 */
function translateNavReduce(recv: Node, args: readonly Node[], ctx: TranslateContext): string {
  const chain = matchNavChain(recv, ctx);
  if (!chain) {
    return ctx.fail(
      "R2001",
      ".reduce() translates only over a declared navigation collection — check the relations map on the context.",
    );
  }
  const shapeError = (): never =>
    ctx.fail(
      "R2001",
      "Only the sum idiom `nav.reduce((acc, o) => acc + expr, 0)` (a constant numeric seed, " +
        "`acc` on one side of a `+`) translates to SQL.",
    );
  const lambda = args[0];
  const init = args[1];
  if (
    lambda?.kind !== "Lambda" ||
    lambda.params.length < 2 ||
    init?.kind !== "Constant" ||
    typeof init.value !== "number"
  ) {
    return shapeError();
  }
  const acc = lambda.params[0] as string;
  const element = lambda.params[1] as string;
  const body = lambda.body;
  if (body.kind !== "Binary" || body.op !== "+") return shapeError();
  const isAcc = (n: Node): boolean => n.kind === "Param" && n.name === acc;
  const selector = isAcc(body.left) ? body.right : isAcc(body.right) ? body.left : null;
  if (!selector) return shapeError();

  const sum = navSubquery(chain, ctx, (dialect, childCtx, childShape) => {
    const inner = childCtx.scoped(new Map([[element, childShape]]));
    return dialect.floatCast(`SUM(${translate(selector, inner)})`);
  });
  const coalesced = `COALESCE(${sum}, 0)`;
  return init.value === 0 ? coalesced : `(${ctx.param(init.value)} + ${coalesced})`;
}

function translateLike(
  method: "startsWith" | "endsWith" | "includes",
  recv: Node,
  args: readonly Node[],
  ctx: TranslateContext,
): string {
  const arg = args[0];
  // Array membership: constant array .includes(column)
  if (method === "includes" && recv.kind === "Constant" && Array.isArray(recv.value)) {
    return ctx.dialect.arrayContains(translate(arg as Node, ctx), recv.value, ctx);
  }
  if (!arg || arg.kind !== "Constant" || typeof arg.value !== "string") {
    return ctx.fail(
      "R2001",
      `.${method}() requires a constant string argument for a SQL string match.`,
    );
  }
  return ctx.dialect.stringMatch(method, translate(recv, ctx), arg.value, ctx);
}

/** `needle` ∈ `haystack`, where `haystack` must be a constant array. */
function translateIn(needle: Node, haystack: Node, ctx: TranslateContext): string {
  if (haystack.kind === "Constant" && Array.isArray(haystack.value)) {
    return ctx.dialect.arrayContains(translate(needle, ctx), haystack.value, ctx);
  }
  return ctx.fail("R2001", "Membership requires a constant array on the right.");
}

function translateTemplate(
  node: Extract<Node, { kind: "Template" }>,
  ctx: TranslateContext,
): string {
  const parts: string[] = [];
  node.quasis.forEach((q, i) => {
    if (q !== "") parts.push(ctx.param(q));
    const expr = node.exprs[i];
    if (expr) parts.push(`COALESCE(CAST(${translate(expr, ctx)} AS TEXT), '')`);
  });
  return parts.length > 0 ? `(${parts.join(" || ")})` : ctx.param("");
}
