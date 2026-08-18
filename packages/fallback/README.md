# @greffon/fallback

The runtime fallback of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript. When no build
plugin ran, a provider that needs a tree has nothing to read; this package recovers one at runtime by parsing the
lambda's `Function.prototype.toString()` text with meriyah (a small pure-JS parser, so it works in browsers) and
running it through the same subset validator as the build. Dev-only: it exists so you can try Greffon, or run a
script, without configuring a build. Production builds use
[`@greffon/vite`](https://github.com/PhenX/Greffon/tree/main/packages/vite) or
[`@greffon/ts-transformer`](https://github.com/PhenX/Greffon/tree/main/packages/ts-transformer).

## Install

```
npm install @greffon/fallback
```

## Usage

Import the side-effect entry once, anywhere before a provider reads a tree:

```ts
import "@greffon/fallback/register";
```

The fallback is lazy. `expr()` values and query lambdas keep working as plain functions; the host runs only when a
provider actually reads a tree the build never produced, and the first use prints an `R3001` warning naming the build
plugin. In-memory querying never triggers it — the memory provider calls the compiled lambda directly.

## Limits

- Closures cannot be read: `toString()` returns source text only, so a lambda capturing a variable
  (`u => u.age >= minAge`) throws `R3002` naming `minAge`, never a silent wrong result. Inline the value, or use the
  build plugin — its capture is closure-aware.
- Arrow functions only (`R1107` otherwise), and the usual subset rules apply (`R1103` for `==`, …).
- Refused in production: when `NODE_ENV` is `"production"` the host throws `R3003`, since minified source cannot be
  reparsed reliably.

## API

- `enableFallback()`: register the fallback host with `@greffon/core` — what `./register` does on import. Idempotent.
- `parseFunctionSource(source)` / `reifyFromSource(source)`: the parsing layer under the host, exported for tooling.
- `fallbackHost`: the host itself, for wiring manually via core's `__setFallbackHost`.

## Docs

- [Getting started — without the plugin](https://phenx.github.io/Greffon/guide/getting-started)
- [The boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
