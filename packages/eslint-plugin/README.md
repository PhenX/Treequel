# @greffon/eslint-plugin

The lint surface of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: ESLint rules that
enforce the expression-lambda subset, in ESLint and in oxlint.

One validator backs three hosts: the rules share `@greffon/capture`'s subset checks with the build transform and
[`@greffon/ts-plugin`](https://github.com/PhenX/Greffon/tree/main/packages/ts-plugin), so an invalid lambda gets the
same [`Rxxxx`](https://phenx.github.io/Greffon/errors) code and span as a squiggle, a lint finding, and a build error.

## Install

```
npm install -D @greffon/eslint-plugin
```

## Usage

In ESLint, use the flat-config preset (the peer dependency is `eslint` >=8):

```js
import greffon from "@greffon/eslint-plugin";

export default [greffon.configs.recommended];
```

oxlint loads ESLint plugins too, through `jsPlugins` (alpha, not semver-guarded). Greffon's own `.oxlintrc.json`:

```json
{
  "jsPlugins": [{ "name": "greffon", "specifier": "@greffon/eslint-plugin" }],
  "rules": {
    "greffon/valid-expression": "error",
    "greffon/no-opaque-callback": "warn"
  }
}
```

## Rules

- `greffon/valid-expression` (`error` in `recommended`): rejects out-of-subset syntax with the shared codes, and
  autofixes `==`/`!=` to `===`/`!==` ([R1103](https://phenx.github.io/Greffon/errors#R1103)).
- `greffon/no-opaque-callback` (`warn` in `recommended`): flags a function passed by reference where a provider would
  need a tree ([R2003](https://phenx.github.io/Greffon/errors#R2003)), the lint-time face of
  [the boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule).

The rules run without type information. They check `expr()` calls and query calls whose receiver roots at a
`createContext()` result from `@greffon/query`, traced within one file. A context imported from another module is not
checked at lint time; the build transform and the editor plugin resolve receivers across modules and catch it.

## Docs

- [Editor & lint](https://phenx.github.io/Greffon/guide/editor-and-lint)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
