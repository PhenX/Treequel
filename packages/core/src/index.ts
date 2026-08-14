/**
 * `@treequel/core` — the runtime heart: `Expr`, tree traversal, partial
 * evaluation, printing, and the shared WellKnown/globals vocabularies.
 * Depends only on `@treequel/tree`.
 */
export {
  type Expr,
  type ExprInit,
  type FallbackHost,
  isExpr,
  expr,
  __expr,
  __setFallbackHost,
} from "./expr.js";
export {
  type VisitFns,
  type RewriteFns,
  children,
  mapChildren,
  visit,
  rewrite,
} from "./visitor.js";
export { type EvalEnv, evaluate } from "./evaluate.js";
export {
  type PartialEvalInput,
  partialEval,
  foldConstants,
  isClosed,
} from "./partial-eval.js";
export { print } from "./printer.js";
export { b } from "./builders.js";
export {
  type WellKnownEntry,
  REALM,
  GLOBALS_SAFELIST,
  WellKnown,
  isWellKnown,
} from "./wellknown.js";

// Re-export the tree algebra so consumers have one import for the common case.
export * from "@treequel/tree";
