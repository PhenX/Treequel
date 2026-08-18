# Editor & lint

One subset validator backs three hosts: the build transform, the editor, and the linter. An invalid query lambda
produces the same coded message — same [`Rxxxx`](/errors) code, same span — as a red squiggle while you type, a lint
failure in CI, and a build diagnostic. This page wires up the first two hosts that are not the build.

## Editor squiggles

`@greffon/ts-plugin` is a TypeScript language-service plugin. Install it and list it in `tsconfig.json`:

```sh
npm i -D @greffon/ts-plugin
```

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@greffon/ts-plugin" }]
  }
}
```

It flags lambdas at query call sites and inside `expr()`, resolving the receiver by type — so `db.users.filter(…)` is
checked even when `db` is imported from another module, while an ordinary `rows.filter(…)` on an array is left alone.

Two things to know:

- The `plugins` field configures the **language service only** — it changes what your editor reports, never what
  `tsc` emits. Reifying trees in a `tsc`-only build is a separate concern:
  [Compiling with tsc](/guide/compiling-with-tsc).
- Editors load language-service plugins from the workspace TypeScript, so point your editor at the workspace version
  (in VS Code: **TypeScript: Select TypeScript Version → Use Workspace Version**).

## Lint

`@greffon/eslint-plugin` runs the same validator at lint time. It is an ESLint plugin, and oxlint loads ESLint
plugins through `jsPlugins` (alpha, not semver-guarded) — one package covers both linters.

::: code-group

```js [eslint.config.js]
import greffon from "@greffon/eslint-plugin";

export default [greffon.configs.recommended];
```

```json [.oxlintrc.json]
{
  "jsPlugins": [{ "name": "greffon", "specifier": "@greffon/eslint-plugin" }],
  "rules": {
    "greffon/valid-expression": "error",
    "greffon/no-opaque-callback": "warn"
  }
}
```

:::

- **`greffon/valid-expression`** rejects out-of-subset syntax with the shared codes, and autofixes `==`/`!=` to
  `===`/`!==` ([R1103](/errors#R1103)).
- **`greffon/no-opaque-callback`** flags a function passed by reference where a provider would need a tree — the
  lint-time face of [the boundary rule](/guide/the-boundary-rule).

The rules run without type information: they check `expr()` calls and query calls whose receiver roots at a
`createContext()` result in the same file, so a plain `array.filter()` is left alone. A context imported from another
module is not checked at lint time; the build transform and the editor plugin resolve receivers across modules and
catch it. `no-opaque-callback` stays a warning because a bare identifier can also hold an `expr()`-built tree.

## Enforcement

The editor plugin and the lint rules are opt-in. A project turns them on in its own `tsconfig.json` and lint config,
and nothing a package ships can make that happen for someone else — there is no way to force a consumer to enable an
ESLint rule or a language-service plugin. They are fast feedback, not a gate. The gate is the build.

- **The build transform is the enforceable check.** The [Vite plugin](/guide/getting-started) validates every reified
  lambda; in a production build a subset violation is an error that fails the build (`diagnostics` defaults to `error`
  under `vite build`, `warn` in the dev server). A `tsc`-only build gets the same gate from
  [`@greffon/ts-transformer`](/guide/compiling-with-tsc) with `diagnostics: "error"`. You run one of these to get
  expression trees at all, so the check rides along with the mechanism you already depend on.
- **The runtime is the backstop.** A lambda that reaches a provider needing a tree, without one, fails at plan-build
  time with [R2003](/errors#R2003); the runtime fallback refuses to parse in a production build
  ([R3003](/errors#R3003)). Wrong SQL is never emitted silently.
- **Lint and the editor are the early face of the same check.** One validator, the same [codes](/errors), reported
  while you type and in CI — sooner than a build, but only where they are turned on.

For CI specifically: you do not inject a rule into someone else's pipeline; you make their build fail, and their
pipeline already runs their build. The [`examples/`](https://github.com/PhenX/Greffon/tree/main/examples) projects wire
up both halves — the plugin in `vite.config.ts` and the rules in `.oxlintrc.json`.

### Why not a type error?

A fair question is whether the subset could be enforced by types alone, so plain `tsc` rejects an out-of-subset lambda
with no plugin at all. It cannot. The subset is a property of *syntax*, and TypeScript types describe values, not the
shape of the code that produced them. `u => { return u.age > 1 }` has the same type as `u => u.age > 1`; `u => u.age ==
1` types identically to the `===` form; a function passed by reference is indistinguishable by type from the same
function written inline. That is why one validator walks the AST and is shared across the build, the editor, and the
linter, rather than living in the type signatures.

## Where to go next

- [The expression subset](/guide/the-subset) — the grammar all three hosts enforce.
- [Error reference](/errors) — every code these tools can emit, one anchor each.
