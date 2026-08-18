/**
 * The recursive tree→SQL translator. {@link translate} switches on node kind
 * and delegates: member paths (columns, JSONB, group keys, navigation and
 * group counts), operators, string/array/template calls, and the correlated
 * subqueries and aggregates that navigations and groups compile to.
 */
import type { Node } from "@greffon/core";
import {
  type ColumnShape,
  SCALAR_COLUMN,
  type TranslateContext,
  quoteIdent,
  shapeColumn,
} from "./context.js";
import type { SqlDialect } from "./dialect.js";
import { physicalColumn } from "./schema.js";
import {
  type GroupItemsChain,
  type NavChain,
  matchGroupItems,
  matchNavChain,
  reduceIdiom,
} from "./patterns.js";

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
  // Group count / navigation count / string length
  if (node.prop === "length") {
    const items = matchGroupItems(node.object, ctx);
    if (items) {
      return ctx.dialect.floatCast(groupCount(items, ctx));
    }
    const chain = matchNavChain(node.object, ctx);
    if (chain) {
      return navSubquery(chain, ctx, (d) => d.floatCast("COUNT(*)"));
    }
    return `LENGTH(${translate(node.object, ctx)})`;
  }
  // Group key: `g.key` (scalar) or `g.key.prop` (composite)
  if (node.object.kind === "Param") {
    const shape = paramShape(node.object, ctx);
    if (shape.kind === "group") {
      if (node.prop !== "key") {
        return ctx.fail("R2002", `A group has no property '${node.prop}' — use g.key or g.items.`);
      }
      const scalar = shape.keyParts.length === 1 && shape.keyParts[0]?.name === null;
      if (!scalar) {
        return ctx.fail(
          "R2001",
          "A composite group key projects one property at a time (g.key.prop).",
        );
      }
      return (shape.keyParts[0] as { sql: string }).sql;
    }
    return shapeColumn(shape, node.prop, ctx);
  }
  if (
    node.object.kind === "Member" &&
    node.object.prop === "key" &&
    node.object.object.kind === "Param"
  ) {
    const shape = ctx.shapeOf(node.object.object.name);
    if (shape?.kind === "group") {
      const part = shape.keyParts.find((p) => p.name === node.prop);
      if (!part) {
        return ctx.fail("R2002", `'${node.prop}' is not a property of the group key.`);
      }
      return part.sql;
    }
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
    case "reduce": {
      const items = matchGroupItems(recv, ctx);
      if (items) return translateGroupReduce(items, args, ctx);
      return translateNavReduce(recv, args, ctx);
    }
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
    case "getFullYear":
      return ctx.dialect.dateExtract("year", translate(recv, ctx));
    case "getMonth":
      // JS getMonth() is 0-based (January is 0); calendar months are 1-based.
      return `(${ctx.dialect.dateExtract("month", translate(recv, ctx))} - 1)`;
    case "getDate":
      return ctx.dialect.dateExtract("day", translate(recv, ctx));
    default:
      return ctx.fail(
        "R2001",
        `Call '.${method}()' is not translatable by the ${ctx.dialect.name} provider — cross the .inMemory() boundary or extend the dialect.`,
      );
  }
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
 * `reduce` over a navigation chain: the sum idiom only — an empty navigation
 * must yield the seed, which `COALESCE(SUM…, 0)` matches; `MIN`/`MAX` over an
 * empty set is `NULL`, not the JS seed, so those idioms stay group-only.
 */
function translateNavReduce(recv: Node, args: readonly Node[], ctx: TranslateContext): string {
  const chain = matchNavChain(recv, ctx);
  if (!chain) {
    return ctx.fail(
      "R2001",
      ".reduce() translates only over a declared navigation collection or a group's items.",
    );
  }
  const idiom = reduceIdiom(args, ctx);
  if (idiom.agg !== "SUM") {
    return ctx.fail(
      "R2001",
      "Min/max reduce idioms apply to group items; over a navigation an empty set would be NULL, not the seed.",
    );
  }
  const sum = navSubquery(chain, ctx, (dialect, childCtx, childShape) => {
    const inner = childCtx.scoped(new Map([[idiom.element, childShape]]));
    return dialect.floatCast(`SUM(${translate(idiom.selector, inner)})`);
  });
  const coalesced = `COALESCE(${sum}, 0)`;
  return idiom.seed === 0 ? coalesced : `(${ctx.param(idiom.seed)} + ${coalesced})`;
}

/** A filter chain becomes a CASE guard inside the aggregate. */
function groupGuard(
  items: GroupItemsChain,
  ctx: TranslateContext,
  value: string,
  elseSql: string | null,
): string {
  if (items.filters.length === 0) return value;
  const conds = items.filters.map((f) => {
    const inner = ctx.scoped(new Map([[f.params[0] as string, items.group.item]]));
    return `(${translate(f.body, inner)})`;
  });
  const elsePart = elseSql === null ? "" : ` ELSE ${elseSql}`;
  return `CASE WHEN ${conds.join(" AND ")} THEN ${value}${elsePart} END`;
}

function groupCount(items: GroupItemsChain, ctx: TranslateContext): string {
  return items.filters.length === 0 ? "COUNT(*)" : `COUNT(${groupGuard(items, ctx, "1", null)})`;
}

/** `g.items.reduce(…)` → `SUM`/`MIN`/`MAX` over the grouped rows. */
function translateGroupReduce(
  items: GroupItemsChain,
  args: readonly Node[],
  ctx: TranslateContext,
): string {
  const idiom = reduceIdiom(args, ctx);
  const inner = ctx.scoped(new Map([[idiom.element, items.group.item]]));
  const sel = translate(idiom.selector, inner);
  if (idiom.agg === "SUM") {
    const guarded = groupGuard(items, ctx, sel, "0");
    const sum = ctx.dialect.floatCast(`COALESCE(SUM(${guarded}), 0)`);
    return idiom.seed === 0 ? sum : `(${ctx.param(idiom.seed)} + ${sum})`;
  }
  // Groups are never empty, so MIN/MAX always see a row. A filter could empty
  // one, where SQL yields NULL but the JS reduce yields its seed — refuse
  // rather than diverge.
  if (items.filters.length > 0) {
    return ctx.fail(
      "R2001",
      "Min/max reduce idioms do not compose with .filter() — an emptied group would be NULL in SQL but the seed in JS.",
    );
  }
  return ctx.dialect.floatCast(`${idiom.agg}(${sel})`);
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
