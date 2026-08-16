# `@treequel/ts-transformer` — area guide

Read this with the root [AGENTS.md](../../AGENTS.md) and plan §7. This package lets the reification run when the build
goes through the TypeScript compiler (via ts-patch or the compiler API) instead of a bundler. It is the compiler-side
sibling of `@treequel/vite`.

## The rules that are easy to get wrong

- **One parser, and it is not here.** All tracing, capture and detection live in `@treequel/transform` (oxc). This
  package never parses query source with `oxc-parser` or re-implements detection — it calls `planModuleSync` /
  `scanModuleContexts` and applies the result. Reusing the transform is what keeps the tsc path and the Vite path from
  disagreeing about what is legal. `typescript` is a **peer** dependency: the compiler is the host, brought by the user.

- **Synchronous only.** A compiler emit transformer runs synchronously, so this package uses the `*Sync` entry points.
  There is no on-demand module `load`; cross-module contexts resolve from a whole-program pre-scan done once when the
  factory is built (`program.getSourceFiles()` → `scanModuleContexts`).

- **Edit the AST, do not re-parse the file.** Reification is applied as a surgical AST transform: replace each detected
  node (the arrow, or the `expr(...)` wrapper) by its source span, and inject the host import with `ts.factory`.
  Returning a whole re-parsed `SourceFile` does **not** work — its nodes carry no symbols, and the compiler's import
  elision dereferences symbols during emit and crashes. Replacement subtrees parsed from the edit text must be marked
  synthesized (the `Synthesized` node flag **and** `pos/end = -1`) so the emitter prints them from structure and the
  emit resolver skips them.

- **ES modules only.** The injected `import { __expr as __tql_expr$ } from "@treequel/core"` is a live ES-module
  binding. Under CommonJS output the reference is left unbound (the module transform only rewrites parse-tree
  references, not our synthesized one), so the transformer throws rather than emit broken code. This matches Treequel's
  ESM-only stance; `module` must be `esnext`/`nodenext`/`es20xx`.

- **The emitted shape is the contract.** The `__tql_expr$({ v: 1, … })` literal and its idempotence guard are shared
  with `transform`/`core`; they move together. Because the replacement text comes straight from `planModuleSync`, this
  package inherits that shape for free — do not hand-build the literal here.

## Testing

Tests compile virtual files through a real `ts.Program` with an in-memory `CompilerHost` and run the transformer as a
`before` transformer, then assert on the emitted `.js`. That exercises the whole path — splice, synthesize, then the
compiler's own type-stripping and module lowering. Keep `noLib: true` so the program builds fast.
