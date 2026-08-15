/**
 * `@treequel/linq` — the query layer: `Queryable`, the `QueryPlan` a provider
 * receives, the provider protocol, and `createContext`. Depends only on
 * `@treequel/core`. The in-memory engine lives here too so it is the single
 * shared reference semantics.
 */
export {
  type AnyExpr,
  type ExecKind,
  type IncludeSpec,
  type PlanOp,
  type QueryPlan,
  PLAN_OP_KINDS,
  withOp,
} from "./plan.js";
export { type Capabilities, type QueryProvider, capabilities } from "./provider.js";
export { type Grouping, type RowSource, applyOps, runPlanInMemory } from "./memory-engine.js";
export {
  type Relation,
  type RelationsMeta,
  type SchemaRelations,
  defineRelations,
} from "./relations.js";
export { collectIncludes, mergeIncludeSpecs } from "./include-spec.js";
export { attachChildren, collectKeys } from "./stitch.js";
export {
  type Context,
  type ContextOptions,
  type Includable,
  type Key,
  type KeysWithValue,
  type Loaded,
  type NavElement,
  type NavSelector,
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
