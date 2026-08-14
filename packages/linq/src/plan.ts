import type { Expr } from "@treequel/core";

/** An `Expr` of any function shape — plan ops are heterogeneous. */
export type AnyExpr = Expr<(...a: never[]) => unknown>;

export type ExecKind =
  | "toArray"
  | "first"
  | "single"
  | "count"
  | "any"
  | "all"
  | "sum"
  | "min"
  | "max"
  | "avg";

export type PlanOp =
  | { readonly op: "where"; readonly expr: AnyExpr }
  | { readonly op: "select"; readonly expr: AnyExpr }
  | { readonly op: "orderBy" | "thenBy"; readonly expr: AnyExpr; readonly desc: boolean }
  | { readonly op: "take" | "skip"; readonly n: number }
  | { readonly op: "distinct" }
  | { readonly op: "groupBy"; readonly expr: AnyExpr }
  | {
      readonly op: "join";
      readonly inner: QueryPlan;
      readonly outerKey: AnyExpr;
      readonly innerKey: AnyExpr;
      readonly result: AnyExpr;
    }
  | { readonly op: "inMemory" }
  | {
      readonly op: "exec";
      readonly kind: ExecKind;
      readonly expr?: AnyExpr;
      readonly orNull?: boolean;
    };

/** The immutable description a provider receives. */
export interface QueryPlan {
  readonly source: string;
  readonly ops: readonly PlanOp[];
}

/** Append an op, returning a new plan (Queryable is immutable). */
export function withOp(plan: QueryPlan, op: PlanOp): QueryPlan {
  return { source: plan.source, ops: [...plan.ops, op] };
}
