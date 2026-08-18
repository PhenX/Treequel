/**
 * `@greffon/transform` — the pure, bundler-free build transform. Reifies
 * lambda literals at traced query call sites (or wrapped in `expr()`) into
 * `__expr({...})`, preserving the original lambda as `compiled`. Driven by any
 * bundler through a tiny host interface.
 */
export {
  type ContextRegistry,
  type ReifyEdit,
  type ReifyPlan,
  type SyncTransformHost,
  type TransformHost,
  type TransformOptions,
  type TransformResult,
  HOST_IMPORT,
  createRegistry,
  planModuleSync,
  scanModuleContexts,
  transformModule,
  transformModuleSync,
} from "./transform.js";
export { emitNode, offsetToLineCol } from "./emit.js";
