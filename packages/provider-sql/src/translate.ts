import { type Node, TreequelError } from "@treequel/core";
import { type TableMeta, physicalColumn } from "./schema.js";
import { type SqlDialect, pgDialect } from "./dialect.js";

/** State threaded through a single expression translation. */
export class TranslateContext {
  readonly values: unknown[] = [];
  constructor(
    readonly meta: TableMeta,
    readonly alias: string,
    readonly dialect: SqlDialect = pgDialect,
    readonly loc?: string,
  ) {}

  param(value: unknown): string {
    this.values.push(value);
    return this.dialect.placeholder(this.values.length);
  }

  private located(detail: string): string {
    return this.loc ? `${detail} (${this.loc})` : detail;
  }

  fail(code: string, detail: string): never {
    throw new TreequelError(code, this.located(detail));
  }
}

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
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

/** Translate a (partial-evaluated, param-rooted) tree to a pg SQL fragment. */
export function translate(node: Node, ctx: TranslateContext): string {
  switch (node.kind) {
    case "Constant":
      return node.value === null ? "NULL" : ctx.param(node.value);

    case "Param":
      return ctx.fail("R2001", "Bare row reference is not translatable; project specific columns.");

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

function translateMember(node: Extract<Node, { kind: "Member" }>, ctx: TranslateContext): string {
  // string/array .length
  if (node.prop === "length") {
    return `LENGTH(${translate(node.object, ctx)})`;
  }
  // Direct column: Member(Param, col)
  if (node.object.kind === "Param") {
    return `${quoteIdent(ctx.alias)}.${quoteIdent(physicalColumn(ctx.meta, node.prop))}`;
  }
  // One level of JSONB path: Member(Member(Param, jsonCol), key)
  if (node.object.kind === "Member" && node.object.object.kind === "Param") {
    const col = node.object.prop;
    if (ctx.meta.json?.includes(col)) {
      return `${quoteIdent(ctx.alias)}.${quoteIdent(physicalColumn(ctx.meta, col))}->>'${node.prop.replace(/'/g, "''")}'`;
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
