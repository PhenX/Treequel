# @greffon/transform

The build transform of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript, as a pure
per-module function. It parses a module with oxc-parser, finds query lambdas at traced call sites and in `expr()`
wrappers, validates them against the expression subset, and reifies each into `__expr({...})` — the tree inlined as a
plain object, the original lambda kept as `compiled`.

This package is for embedding the transform in another build tool. Writing an app, use a host instead:
[`@greffon/vite`](https://github.com/PhenX/Greffon/tree/main/packages/vite) for Vite, Rollup, and Rolldown, or
[`@greffon/ts-transformer`](https://github.com/PhenX/Greffon/tree/main/packages/ts-transformer) for `tsc`-only builds.
Both are thin hosts over this package; sharing it is what keeps the two paths agreeing on what is legal.

## Install

```
npm install @greffon/transform
```

## Usage

```ts
import { transformModule } from "@greffon/transform";

const result = await transformModule(code, "src/queries.ts");
// null when the module needs no change, else { code, map, diagnostics, count }
```

## API

- `transformModule(code, id, options?, host?)`: the async text transform. A `TransformHost` (`resolve` + `load`) lets
  the bundler resolve contexts imported from other modules on demand.
- `transformModuleSync(code, id, options?, host?)`: the same for hosts that cannot await. A `SyncTransformHost` only
  resolves; pre-scan every module with `scanModuleContexts` to fill the registry first.
- `planModuleSync(code, id, options?, host?)`: the same detection as a `ReifyPlan` — a list of
  `{ start, end, replacement }` edits in source coordinates, for hosts that edit an AST rather than text.
- `scanModuleContexts(code, id, options?)`: names bound to `createContext()` at a module's top level, no transform.
- `createRegistry()`: the `ContextRegistry` a whole build shares so cross-module contexts resolve.
- `HOST_IMPORT`: the import reified modules need — `__expr` from `@greffon/core`, aliased locally.
- `TransformOptions`: `packages` (default `["@greffon/query"]`), `globals`, `emitSource` (default `true`), `registry`.

The `@greffon/transform/emit` entry exports `emitNode` (render a tree as a JS object-literal expression) and
`offsetToLineCol` on their own, without loading oxc-parser, which is a native binding.

## Docs

- [Getting started](https://phenx.github.io/Greffon/guide/getting-started)
- [The subset](https://phenx.github.io/Greffon/guide/the-subset)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
