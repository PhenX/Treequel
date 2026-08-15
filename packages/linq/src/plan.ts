import type { Expr } from "@treequel/core";
import type { RelationsMeta } from "./relations.js";

/** An `Expr` of any function shape — plan ops are heterogeneous. */
export type AnyExpr = Expr<(...a: never[]) => unknown>;

export type ExecKind =
  | "toArray"
  | "first"
  | "single"
  | "count"
  | "some"
  | "every"
  | "sum"
  | "min"
  | "max"
  | "avg";

/**
 * A resolved navigation to load with the query, self-contained: providers read
 * everything they need (target source, key pair, cardinality) from the spec and
 * never consult relation metadata themselves. `children` carries nested
 * `thenInclude` levels.
 */
export interface IncludeSpec {
  /** Property name the loaded rows are attached under (e.g. `"orders"`). */
  readonly nav: string;
  /** Source name of the related rows (e.g. `"orders"`). */
  readonly target: string;
  /** Key property on the parent row. */
  readonly from: string;
  /** Key property on the related row. */
  readonly to: string;
  /** `"many"` attaches an array; `"one"` attaches a single row or `null`. */
  readonly kind: "one" | "many";
  /**
   * Refinement of the loaded rows: `where`/`orderBy`/`thenBy` ops applied to
   * the children before attaching. An explicit order replaces the canonical
   * attachment order; `take`/`skip` apply per parent.
   */
  readonly ops?: readonly PlanOp[];
  /** Per-parent slice, applied after `ops`. */
  readonly take?: number;
  readonly skip?: number;
  readonly children?: readonly IncludeSpec[];
}

export type PlanOp =
  | { readonly op: "where"; readonly expr: AnyExpr }
  | { readonly op: "select"; readonly expr: AnyExpr }
  | { readonly op: "orderBy" | "thenBy"; readonly expr: AnyExpr; readonly desc: boolean }
  | { readonly op: "take" | "skip"; readonly n: number }
  | { readonly op: "distinct" }
  | { readonly op: "groupBy"; readonly expr: AnyExpr }
  | {
      readonly op: "join" | "leftJoin";
      readonly inner: QueryPlan;
      readonly outerKey: AnyExpr;
      readonly innerKey: AnyExpr;
      readonly result: AnyExpr;
    }
  | { readonly op: "include"; readonly spec: IncludeSpec }
  | {
      /**
       * Expand each row through a declared navigation (EF `SelectMany`): the
       * element becomes the related row, or `result(parent, child)` when a
       * selector is given. Null keys expand to nothing.
       */
      readonly op: "flatMap";
      readonly nav: string;
      readonly target: string;
      readonly from: string;
      readonly to: string;
      readonly result?: AnyExpr;
    }
  | { readonly op: "inMemory" }
  | {
      readonly op: "exec";
      readonly kind: ExecKind;
      readonly expr?: AnyExpr;
      readonly orNull?: boolean;
    };

/** Every plan op kind — the capability set of a provider that supports everything. */
export const PLAN_OP_KINDS: readonly string[] = [
  "where",
  "select",
  "orderBy",
  "thenBy",
  "take",
  "skip",
  "distinct",
  "groupBy",
  "join",
  "leftJoin",
  "include",
  "flatMap",
  "inMemory",
  "exec",
];

/**
 * The immutable description a provider receives. `relations` is the context's
 * navigation metadata, embedded so predicates over navigations
 * (`u.orders?.some(…)`) resolve inside providers with no side channel.
 */
export interface QueryPlan {
  readonly source: string;
  readonly ops: readonly PlanOp[];
  readonly relations?: RelationsMeta;
}

/** Append an op, returning a new plan (Queryable is immutable). */
export function withOp(plan: QueryPlan, op: PlanOp): QueryPlan {
  return { ...plan, ops: [...plan.ops, op] };
}

/**
 * The source whose rows the plan's elements still are — following `flatMap`
 * into its target — or `undefined` once a `select`/`groupBy`/`join` reshapes
 * them. Build-time navigation resolution keys off this.
 */
export function elementSource(plan: QueryPlan): string | undefined {
  let source: string | undefined = plan.source;
  for (const op of plan.ops) {
    if (op.op === "flatMap") source = op.result ? undefined : op.target;
    else if (
      op.op === "select" ||
      op.op === "groupBy" ||
      op.op === "join" ||
      op.op === "leftJoin"
    ) {
      source = undefined;
    }
  }
  return source;
}
