# @greffon/vite

The build plugin of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript. At build time it
validates each query lambda against the expression subset and reifies it into `__expr({...})`: the tree inlined as a
plain object, the original function kept alongside as `compiled`. An out-of-subset lambda gets a coded diagnostic
(`R1103` for `==`, …); every code has an entry in the [error reference](https://phenx.github.io/Greffon/errors).

The plugin uses only Rollup-compatible hooks, so the same export runs unchanged in Vite, Rollup, and Rolldown.

## Install

```
npm install -D @greffon/vite
```

## Usage

```ts
// vite.config.ts
import { greffon } from "@greffon/vite";

export default {
  plugins: [greffon()],
};
```

That is the whole setup. Lambdas at traced query call sites (`db.users.filter(u => u.age >= 18)`) and `expr()`
wrappers reify; everything else in the module is left alone, and a second pass over already-transformed code is a
no-op.

## Options

All optional, passed as `greffon({ … })`:

- `packages`: import sources whose query methods are traced. Default `["@greffon/query"]`.
- `include` / `exclude`: RegExp filters on module ids. Defaults `/\.[cm]?[jt]sx?$/` and `/node_modules/`.
- `diagnostics`: `"error"` fails the build, `"warn"` prints. Default `"error"` in build, `"warn"` in dev.
- `emitSource`: keep the original lambda text on the tree as `src`. Default `"dev"`: on in serve, off in build.
- `globals`: extra identifiers treated as safe globals during capture.

## Without the plugin

In-memory querying works with no plugin at all: the memory provider calls your compiled lambda and never reads the
tree, so the same query files run unchanged under Vitest. A provider that needs the tree (SQL, anything remote) does
require the plugin — or the dev-only runtime fallback,
[`@greffon/fallback`](https://github.com/PhenX/Greffon/tree/main/packages/fallback). Compiling with `tsc` and no
bundler, use [`@greffon/ts-transformer`](https://github.com/PhenX/Greffon/tree/main/packages/ts-transformer).

## Docs

- [Getting started](https://phenx.github.io/Greffon/guide/getting-started)
- [The subset](https://phenx.github.io/Greffon/guide/the-subset)
- [The boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
