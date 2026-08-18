# Compiling with tsc

Most projects reify query lambdas with the [Vite plugin](/guide/getting-started) — it covers Vite, Rollup and Rolldown,
and it is the recommended path. This page is for the other case: a project that compiles with the **TypeScript compiler
directly** and has no bundler, such as a backend that runs `tsc` (or `tsc -b`) to emit `dist/` and then runs Node on the
output.

## Stock `tsc` runs no transformer

The `tsc` CLI does not apply custom emit transformers, and the `plugins` field in `tsconfig.json` configures only
language-service (editor) plugins — the slot where [the editor plugin](/guide/editor-and-lint) loads — which the
compiler ignores during emit. So there are two ways to run a transformer over
your build: **ts-patch**, which patches the installed compiler so `tsc` picks up transformers from `tsconfig.json`, or
the **compiler API**, where you drive `program.emit` yourself. `@greffon/ts-transformer` supports both.

## With ts-patch

```sh
npm i -D @greffon/ts-transformer ts-patch
```

Register the transformer in `tsconfig.json`, then let ts-patch run the compiler:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "plugins": [{ "transform": "@greffon/ts-transformer" }]
  }
}
```

```sh
npx tspc          # ts-patch's tsc wrapper — or run `ts-patch install` once, then use tsc as usual
```

Any [transformer option](#options) goes on the same plugin entry:

```json
{ "transform": "@greffon/ts-transformer", "packages": ["@greffon/query"], "diagnostics": "error" }
```

## With the compiler API

If you drive the compiler yourself, pass the factory as a `before` transformer:

```ts
import ts from "typescript";
import { createTransformerFactory } from "@greffon/ts-transformer";

const program = ts.createProgram(fileNames, compilerOptions);
program.emit(undefined, undefined, undefined, false, {
  before: [createTransformerFactory(program, { packages: ["@greffon/query"] })],
});
```

Passing the `program` lets a context imported from another file (`import { db } from "./db"`) resolve — the transformer
pre-scans the program for context definitions. Without a program, only `expr()` wrappers and same-module contexts reify.

## Options

| Option | Default | Meaning |
|---|---|---|
| `packages` | `["@greffon/query"]` | Import sources whose query methods are traced. |
| `emitSource` | `false` | Keep the original lambda text on the tree as `src`. |
| `diagnostics` | `"warn"` | `"error"` fails the build, `"warn"` prints, `"silent"` neither. |
| `include` / `exclude` | `/\.[cm]?[jt]sx?$/` / `/node_modules/` | Which files to process (compiler-API usage only — `tsconfig` cannot carry a RegExp). |
| `globals` | — | Extra identifiers treated as safe globals during capture. |

## What it does and does not do

- **ES-module output is required.** The transformer injects a live ES-module import for the runtime host; set `module`
  to `esnext` or `nodenext`. CommonJS output is refused with an error, because the injected reference would be left
  unbound. Greffon is ESM-only.
- **It runs during emit.** Declaration output (`.d.ts`) and type-checking are unaffected — reification only rewrites the
  emitted JavaScript.
- **A non-`tsc` emitter skips it.** If you type-check with `tsc` but emit with esbuild, swc, or Babel, the transformer
  never runs. Use the Vite plugin there.
- **Source maps are coarser** than the Vite plugin's. The Vite path splices with `magic-string` for precise maps; the
  reified expression here is emitted from its tree structure. If you need exact maps, prefer the bundler plugin.

Subset violations (loose equality, unsupported constructs) are reported the same way everywhere; a lambda that leaves
the subset is left untouched and surfaces as [R2003](/errors#R2003) when a provider that needs a tree receives it.
