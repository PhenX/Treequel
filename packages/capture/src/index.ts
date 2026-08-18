/**
 * `@greffon/capture` — the one shared brain: subset validator, free-variable
 * analysis and tree serializer, operating on a normalized ESTree via an
 * {@link AstAdapter}. Reused by the build transform, the runtime fallback, the
 * language-service plugin and the ESLint rule so they never disagree about what
 * is legal. Depends only on `@greffon/tree`.
 */
export { type AstAdapter, type EsNode, adapterOxc, adapterTsestree } from "./adapter.js";
export { type CaptureOptions, type CaptureResult, capture, GLOBALS_SAFELIST } from "./capture.js";
export {
  type Diagnostic,
  type DiagnosticSpec,
  type Severity,
  DIAGNOSTICS,
  docsAnchor,
  hasErrors,
  makeDiagnostic,
} from "./diagnostics.js";
export { QUERY_METHODS } from "./methods.js";
