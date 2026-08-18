/**
 * Pure structural recognizers over a partial-evaluated tree: a navigation
 * chain (`param.nav`, `nav.filter(l)…`), a group's items (`g.items…`), and the
 * recognized `reduce` idioms. Each inspects the tree and the current
 * {@link TranslateContext} scope; none emit SQL — the translator turns a match
 * into a subquery or aggregate.
 */
import type { Node } from "@greffon/core";
import type { Relation } from "@greffon/query";
import type { ColumnShape, TranslateContext } from "./context.js";

/**
 * A navigation reference inside an expression: `param.nav`, optionally
 * extended by `.filter(l)` steps, resolved against the outer row's shape.
 */
export interface NavChain {
  readonly rel: Relation;
  readonly outer: Extract<ColumnShape, { kind: "table" }>;
  readonly filters: ReadonlyArray<Extract<Node, { kind: "Lambda" }>>;
}

export function matchNavChain(n: Node, ctx: TranslateContext): NavChain | null {
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
 * The recognized reduce idioms — real JS whose SQL meaning is unambiguous:
 *  - sum: `reduce((acc, o) => acc + expr, seed)` with a constant numeric seed
 *  - min: `reduce((m, o) => Math.min(m, expr), Infinity)`
 *  - max: `reduce((m, o) => Math.max(m, expr), -Infinity)`
 * Anything else is refused, never guessed.
 */
export interface ReduceIdiom {
  readonly agg: "SUM" | "MIN" | "MAX";
  readonly selector: Node;
  readonly element: string;
  readonly seed: number;
}

function isMathGlobal(n: Node): boolean {
  if (n.kind === "Capture" && n.name === "Math") return true;
  return n.kind === "Constant" && n.value === Math;
}

export function reduceIdiom(args: readonly Node[], ctx: TranslateContext): ReduceIdiom {
  const shapeError = (): never =>
    ctx.fail(
      "R2001",
      "Only the reduce idioms translate to SQL: the sum idiom " +
        "`reduce((acc, o) => acc + expr, 0)` (constant numeric seed, `acc` on one side of `+`), " +
        "`reduce((m, o) => Math.min(m, expr), Infinity)`, and the `Math.max`/`-Infinity` twin.",
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
  const isAcc = (n: Node): boolean => n.kind === "Param" && n.name === acc;
  const body = lambda.body;

  if (body.kind === "Binary" && body.op === "+") {
    const selector = isAcc(body.left) ? body.right : isAcc(body.right) ? body.left : null;
    if (!selector || !Number.isFinite(init.value)) return shapeError();
    return { agg: "SUM", selector, element, seed: init.value };
  }
  if (
    body.kind === "Call" &&
    body.callee.kind === "Member" &&
    (body.callee.prop === "min" || body.callee.prop === "max") &&
    isMathGlobal(body.callee.object) &&
    body.args.length === 2
  ) {
    const agg = body.callee.prop === "min" ? "MIN" : "MAX";
    const wanted = agg === "MIN" ? Infinity : -Infinity;
    const [a, b] = body.args as [Node, Node];
    const selector = isAcc(a) ? b : isAcc(b) ? a : null;
    if (!selector || init.value !== wanted) return shapeError();
    return { agg, selector, element, seed: init.value };
  }
  return shapeError();
}

/** `g.items` (optionally `.filter(l)`-extended) under a group shape. */
export interface GroupItemsChain {
  readonly group: Extract<ColumnShape, { kind: "group" }>;
  readonly filters: ReadonlyArray<Extract<Node, { kind: "Lambda" }>>;
}

export function matchGroupItems(n: Node, ctx: TranslateContext): GroupItemsChain | null {
  if (n.kind === "Member" && n.prop === "items" && n.object.kind === "Param") {
    const shape = ctx.shapeOf(n.object.name);
    return shape?.kind === "group" ? { group: shape, filters: [] } : null;
  }
  if (
    n.kind === "Call" &&
    n.callee.kind === "Member" &&
    n.callee.prop === "filter" &&
    n.args[0]?.kind === "Lambda"
  ) {
    const base = matchGroupItems(n.callee.object, ctx);
    if (!base) return null;
    return { ...base, filters: [...base.filters, n.args[0]] };
  }
  return null;
}
