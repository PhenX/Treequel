# @greffon/capture

The shared analysis core of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: the subset
validator, the free-variable analysis, and the tree serializer, implemented once. The build transform, the runtime
fallback, the TypeScript language-service plugin, and the ESLint rules all run this same code, so the editor, the
build, and the lint agree on what is legal.

Apps get this package transitively through those hosts. Depend on it directly to build a capture host or adapter of
your own, or to read the diagnostics catalog. Its only runtime dependency is
[`@greffon/tree`](https://github.com/PhenX/Greffon/tree/main/packages/tree); it ships no parser — each host hands it
an already-parsed ESTree arrow node.

## Install

```
npm install @greffon/capture
```

## Usage

```ts
import { adapterOxc, capture } from "@greffon/capture";

// `arrow` is the ESTree node your parser produced for `u => u.age > minAge`
// (oxc-parser and meriyah pair with adapterOxc; TSESTree with adapterTsestree):
const result = capture(arrow, adapterOxc);

result.params; // ["u"]
result.freeVars; // ["minAge"] — what the emitted scope() thunk must close over
result.body; // the serialized tree, or null when a diagnostic is an error
result.diagnostics; // [] here; `u => u.id == 1` would yield R1103, with a span
```

## API

- `capture(arrow, adapter, options?)`: validate an arrow against the subset grammar, resolve parameter vs
  free-variable references, and serialize to a tree, in a single walk. Returns `{ params, body, freeVars,
  diagnostics }` (`CaptureResult`); `options.globals` extends the safelist.
- `adapterOxc` / `adapterTsestree` (with the `AstAdapter` and `EsNode` types): the parser seam. Capture reads
  standard ESTree properties; an adapter abstracts only what differs between parsers, chiefly source spans.
- `DIAGNOSTICS`, `makeDiagnostic`, `hasErrors`, `docsAnchor` (types `Diagnostic`, `DiagnosticSpec`, `Severity`): the
  catalog behind every `Rxxxx` code — severity, message, and fix hint. The docs error reference is generated from
  it, and codes are append-only: never renumbered, never reused.
- `GLOBALS_SAFELIST`: identifiers treated as globals (`Math`, `Date`, `JSON`, …) rather than free variables.
- `QUERY_METHODS`: the query methods whose lambda arguments are traced; one list, so the build transform, the editor
  plugin, and the lint rules trace the same call sites.

## Docs

- [The expression subset](https://phenx.github.io/Greffon/guide/the-subset)
- [Error reference](https://phenx.github.io/Greffon/errors), with an anchor per code, e.g.
  [R1103](https://phenx.github.io/Greffon/errors#R1103)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
