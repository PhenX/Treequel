# @greffon/ts-plugin

The editor surface of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: a language-service
plugin that puts red squiggles on out-of-subset syntax in query lambdas, as you type.

One validator backs three hosts: the plugin shares `@greffon/capture`'s subset checks with the build transform and
[`@greffon/eslint-plugin`](https://github.com/PhenX/Greffon/tree/main/packages/eslint-plugin), so an invalid lambda
gets the same [`Rxxxx`](https://phenx.github.io/Greffon/errors) code and the same span as an editor squiggle, a lint
finding, and a build error.

## Install

```
npm install -D @greffon/ts-plugin
```

## Usage

List the plugin in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@greffon/ts-plugin" }]
  }
}
```

The plugin checks lambdas written at query call sites and inside `expr()`. It resolves the receiver by type, so
`db.users.filter(…)` is checked even when `db` is imported from another module, while an ordinary `rows.filter(…)` on
an array is left alone.

Two things to know:

- The `plugins` field configures the language service only — it changes what your editor reports, never what `tsc`
  emits. Reifying trees in a `tsc`-only build is a separate concern:
  [Compiling with tsc](https://phenx.github.io/Greffon/guide/compiling-with-tsc).
- Editors load language-service plugins from the workspace TypeScript (the peer dependency is `typescript` >=5), so
  point your editor at the workspace version. In VS Code: **TypeScript: Select TypeScript Version → Use Workspace
  Version**.

## Docs

- [Editor & lint](https://phenx.github.io/Greffon/guide/editor-and-lint)
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
