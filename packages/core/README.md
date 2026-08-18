# @greffon/core

The runtime toolkit of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: `Expr`, an
executable function that is also a serializable, typed tree, plus the interpreter, partial evaluation, the
visitor/rewriter, the printer, and the `b` node builders. Its only runtime dependency is
[`@greffon/tree`](https://github.com/PhenX/Greffon/tree/main/packages/tree).

Everything here works on any tree: reified from a lambda at build time, received over the wire, or built by hand.
No build plugin or provider is involved.

## Install

```
npm install @greffon/core
```

## Usage

```ts
import { b, evaluate, partialEval, print } from "@greffon/core";

// The tree for `u => u.age >= minAge`, built with the `b` constructors:
const rule = b.binary(">=", b.member(b.param("u"), "age"), b.capture("minAge"));

evaluate(rule, { params: { u: { age: 36 } }, scope: { minAge: 18 } }); // → true

const folded = partialEval({ body: rule, scope: () => ({ minAge: 18 }) });
print(folded); // "(u.age >= 18)" — minAge is now a constant
```

`evaluate` interprets the closed grammar directly, with no `eval` and no `new Function`, so it runs under a strict
CSP, in workers, and at the edge.

## API

- `expr(fn)` / `Expr` / `isExpr`: the dual of a lambda — `compiled` (the function) plus `params`, `body`, and
  `scope` (the tree). At a traced call site the build plugin fills in the tree; without it, reading `body` needs
  `import "@greffon/fallback/register"`, while `compiled` always works.
- `evaluate(node, env)`: interpret a tree against `{ params, scope }` bindings; no compiled function required.
- `partialEval({ body, scope })`, with `foldConstants` and `isClosed`: fold captured variables and constant subtrees
  to `Constant`s, leaving a residual tree of param-rooted access and operations.
- `visit(node, fns)` / `rewrite(node, fns)`, built on `children` and `mapChildren`: pre-order walk, and bottom-up
  rewrite with structural sharing.
- `print(node)`: render a tree back to readable pseudo-source, for logs and audits.
- `b` and `makeExpr(params, body, opts?)`: build nodes by hand, then wrap the tree as an `Expr` a query operator
  accepts; `compiled` defaults to the interpreter over `body`.
- `WellKnown` / `isWellKnown`, `REALM`, `GLOBALS_SAFELIST`: the shared vocabularies — the member and method names
  first-party providers recognize, the fixed global table, and the identifiers treated as globals.

`@greffon/tree` is re-exported in full, so `serialize`, `deserialize`, `Node`, `GreffonError` and the rest are one
import away. To reify plain lambdas at build time, add
[`@greffon/vite`](https://github.com/PhenX/Greffon/tree/main/packages/vite); to run trees as queries, add
[`@greffon/query`](https://github.com/PhenX/Greffon/tree/main/packages/query) and a provider.

## Docs

- [The expression tree](https://phenx.github.io/Greffon/guide/the-tree)
- [Applications](https://phenx.github.io/Greffon/guide/applications)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
