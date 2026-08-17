# Editor & lint

One subset validator backs three hosts: the build transform, the editor, and the linter. An invalid query lambda
produces the same coded message — same [`Rxxxx`](/errors) code, same span — as a red squiggle while you type, a lint
failure in CI, and a build diagnostic. This page wires up the first two hosts that are not the build.

## Editor squiggles

`@treequel/ts-plugin` is a TypeScript language-service plugin. Install it and list it in `tsconfig.json`:

```sh
npm i -D @treequel/ts-plugin
```

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@treequel/ts-plugin" }]
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

`@treequel/eslint-plugin` runs the same validator at lint time. It is an ESLint plugin, and oxlint loads ESLint
plugins through `jsPlugins` (alpha, not semver-guarded) — one package covers both linters.

::: code-group

```js [eslint.config.js]
import treequel from "@treequel/eslint-plugin";

export default [treequel.configs.recommended];
```

```json [.oxlintrc.json]
{
  "jsPlugins": [{ "name": "treequel", "specifier": "@treequel/eslint-plugin" }],
  "rules": {
    "treequel/valid-expression": "error",
    "treequel/no-opaque-callback": "warn"
  }
}
```

:::

- **`treequel/valid-expression`** rejects out-of-subset syntax with the shared codes, and autofixes `==`/`!=` to
  `===`/`!==` ([R1103](/errors#R1103)).
- **`treequel/no-opaque-callback`** flags a function passed by reference where a provider would need a tree — the
  lint-time face of [the boundary rule](/guide/the-boundary-rule).

The rules match query methods by name, without type information — `no-opaque-callback` is a warning because a bare
identifier can also hold an `expr()`-built tree, and an unrelated API can share an operator name. Scope the rules to
your query modules with overrides if that happens; the build transform and the editor plugin are not affected, since
they trace your context imports instead of matching names.

## Where to go next

- [The expression subset](/guide/the-subset) — the grammar all three hosts enforce.
- [Error reference](/errors) — every code these tools can emit, one anchor each.
