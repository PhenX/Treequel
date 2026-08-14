/**
 * `@treequel/linq` — the query layer: `Queryable`, the `QueryPlan` a provider
 * receives, the provider protocol, and `createContext`. Depends only on
 * `@treequel/core`. The in-memory engine lives here too so it is the single
 * shared oracle semantics.
 */
export {
  type AnyExpr,
  type ExecKind,
  type PlanOp,
  type QueryPlan,
  withOp,
} from "./plan.js";
export {
  type Capabilities,
  type QueryProvider,
  capabilities,
} from "./provider.js";
export {
  type Grouping,
  type RowSource,
  applyOps,
  runPlanInMemory,
} from "./memory-engine.js";
export {
  type Context,
  type Key,
  type Ordered,
  type Pred,
  type Proj,
  type Queryable,
  type Result2,
  createContext,
  queryable,
} from "./queryable.js";

// The Expr host + tree algebra, re-exported for the common single import.
export { type Expr, expr, isExpr } from "@treequel/core";
