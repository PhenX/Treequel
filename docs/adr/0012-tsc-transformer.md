# ADR 0012 — A TypeScript-compiler transformer for the no-bundler build

Status: accepted

## Context

Reification has one build path: the `@treequel/vite` plugin over `@treequel/transform`, which serves Vite, Rollup and
Rolldown. Projects that compile with the TypeScript compiler directly — a backend that runs `tsc` (or `tsc -b`) to emit
`dist/` and then `node dist/` — have no bundler to run the transform, so their query lambdas never become expression
trees and every remote provider falls back to the closure-blind runtime path.

Two facts shape the solution:

- **The stock `tsc` CLI runs no custom emit transformers.** The `plugins` field in `tsconfig.json` configures
  language-service plugins (editor tooling) only; the compiler ignores it during emit, by a standing decision of the
  TypeScript team. Reaching emit transformers means either `ts-patch` (which patches the installed `typescript` so
  `compilerOptions.plugins` transformers run) or driving `program.emit(..., customTransformers)` yourself.
- **A transformer runs during emit, synchronously.** It sees the source before type-stripping, transforms to JS, and
  does not affect `.d.ts` output or type-checking. Emitters that skip the TypeScript program (esbuild, swc, Babel) skip
  it too.

## Decision

A separate package **`@treequel/ts-transformer`** exposing a `before` transformer, usable through ts-patch
(`{ "transform": "@treequel/ts-transformer" }`) or the compiler API (`createTransformerFactory(program)`), with
`typescript` as a peer dependency. It is deliberately a *thin host over `@treequel/transform`*, the same way
`@treequel/vite` is — the tracer, capture and detection stay in one place so the two build paths cannot diverge.

Three sub-decisions were forced by how the compiler works:

1. **Reuse the transform through a synchronous, edit-list API.** `@treequel/transform` gained `transformModuleSync`,
   `planModuleSync` and `scanModuleContexts`, sharing one detection and capture path with the async `transformModule`
   (a byte-parity test pins them together). A transformer cannot `await`, so cross-module contexts resolve from a
   whole-program pre-scan instead of the bundler's on-demand `load`.

2. **Apply the reification as a surgical AST edit, not a whole-file re-parse.** Returning a re-parsed `SourceFile`
   crashes the compiler: its nodes carry no symbols, and import elision dereferences symbols during emit. Instead the
   transformer replaces only the detected nodes (by source span) with synthesized expressions and injects the host
   import with `ts.factory`. `planModuleSync` returns those edits in original coordinates; the oxc and TypeScript spans
   line up because both are UTF-16 offsets into the same text.

3. **ES-module output only.** The injected `import { __expr as __tql_expr$ } from "@treequel/core"` is a live ES-module
   binding. Under CommonJS emit the module transform rewrites parse-tree references but not our synthesized one, leaving
   `__tql_expr$` unbound — so the transformer refuses CommonJS output with a clear error rather than emit broken code.
   Treequel is ESM-only, so this costs nothing real.

Subset diagnostics default to `"warn"` (console) rather than the Vite build default of `"error"`: a transformer has no
clean per-file diagnostic channel across both entry points, the editor plugin and ESLint rule already flag violations at
authoring time, and the runtime R2003 guard is the backstop. `diagnostics: "error"` opts into a hard build failure.

## Consequences

- Reification is available to `tsc`-only projects with no bundler, closing a real gap for backends that compile
  straight to `dist/`.
- `@treequel/transform` grew a small synchronous surface (`transformModuleSync`, `planModuleSync`, `scanModuleContexts`,
  `ReifyEdit`/`ReifyPlan`, `HOST_IMPORT`). No behavior of the existing async path changed.
- `ts-patch` is the user's build tool, not a Treequel dependency; the package works equally through a hand-written
  `program.emit` driver.
- Two limitations are documented, not hidden: source maps through the transformer are coarser than the magic-string
  maps the Vite path produces (the reified expression is emitted from structure), and CommonJS output is refused. Both
  are acceptable under Treequel's ESM-only, bundler-first posture; the Vite plugin remains the recommended path.
- The one-parser rule holds — oxc stays the only query-source parser; TypeScript drives emit only. This departure is
  recorded here because it introduces the compiler as a build-time host and adds a second peer on `typescript`.
