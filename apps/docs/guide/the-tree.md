# The expression tree

The tree is the product: a typed, versioned, JSON-serializable value with a [public schema](/reference/tree-schema).
Once a lambda is a tree, you can run it without its function, ship it across a process boundary, rewrite it, print
it, store it — or hand it to a provider for translation. This page is the toolkit;
[Applications](/guide/applications) is what you build on it.

## The toolkit

Everything here is in `@greffon/tree` and `@greffon/core` — zero-dependency, and independent of any provider.

| Function | From | What it does |
| --- | --- | --- |
| `serialize(node)` / `deserialize(json)` | `@greffon/tree` | Tree ⇄ a `{ v, root }` JSON envelope. Versioned; refuses trees from a newer format. |
| `evaluate(node, env)` | `@greffon/core` | Interpret a tree against `{ params, scope }` bindings — no compiled function required. |
| `partialEval({ body, scope })` | `@greffon/core` | Fold captured variables and constant subtrees to `Constant`s, leaving a residual tree. |
| `print(node)` | `@greffon/core` | Render a tree back to readable pseudo-source, for logs and audits. |
| `visit(node, fns)` / `rewrite(node, fns)` | `@greffon/core` | Walk a tree, or rebuild it with per-kind replacements. |
| `b` | `@greffon/core` | Terse node constructors, for building a tree by hand (a rule builder, a codegen). |
| `makeExpr(params, body, opts?)` | `@greffon/core` | Wrap a hand-built tree as an `Expr` a query operator accepts; `compiled` defaults to the interpreter over `body`. |

## Using a serialized tree

A tree survives `JSON.stringify` and comes back with `deserialize`. The received tree carries no function — you run
it with `evaluate`, which interprets the closed grammar directly (no `eval`, no `new Function`):

```ts
import { serialize, deserialize } from "@greffon/tree";
import { evaluate, expr } from "@greffon/core";

// One side: turn a lambda into a tree and serialize it.
const tree = expr((u: User) => u.age >= minAge && u.active);
const wire = JSON.stringify(serialize(tree.body));

// Other side (another process, worker, or service): parse and run it.
const node = deserialize(JSON.parse(wire));
evaluate(node, { params: { u: someUser }, scope: { minAge: 18 } }); // → boolean
```

`params` binds the lambda parameters (the `u`); `scope` supplies any captured free variables (the `minAge`). Change
the scope and the same tree answers differently — closures are late-bound, exactly as in a live query.

If you would rather hand back a plain function, serialize the whole lambda node instead of its body. `evaluate` of a
`Lambda` returns a real callable:

```ts
const predicate = evaluate(deserialize(JSON.parse(wire))); // (u) => boolean
users.filter(predicate);
```

### Make it self-contained

A tree with captures needs its `scope` at evaluation time. To ship a tree that stands alone, fold the captures into
constants with `partialEval` before serializing — the result is param-rooted data access and constants only:

```ts
import { partialEval, print } from "@greffon/core";

const folded = partialEval({ body: tree.body, scope: () => ({ minAge: 18 }) });
print(folded); // "(u.age >= 18)" — minAge is now a constant
```

### It refuses what it cannot trust

`deserialize` validates as it decodes: an unknown node kind, a malformed node, or a `v` newer than the runtime
understands throws a coded [R1901](/errors#R1901) rather than producing a half-built tree. Combined with the closed
grammar — a finite set of node kinds, no statements, no assignment, no arbitrary function references — a received
tree is data you can validate before you run it, which is what makes accepting one over the wire tractable.

## Building a tree by hand

You do not need a lambda to get a tree. The `b` constructors build nodes directly — useful for a rule builder whose
UI emits trees, or a codegen that targets the format:

```ts
import { b, evaluate } from "@greffon/core";

// u => u.age >= 18 && u.active
const rule = b.logical(
  "&&",
  b.binary(">=", b.member(b.param("u"), "age"), b.const(18)),
  b.member(b.param("u"), "active"),
);
evaluate(rule, { params: { u: someUser } }); // → boolean
```

A tree built this way serializes, prints, evaluates, and translates like any captured one.

To hand a built tree straight to a query operator, wrap it with `makeExpr` — the counterpart to `expr(fn)`. Where
`expr` starts from a function and derives the tree, `makeExpr` starts from the tree and derives the function, so the
result runs in the memory provider and translates in SQL just like a reified lambda:

```ts
import { b, makeExpr } from "@greffon/core";

const isAdult = makeExpr<(u: User) => boolean>(
  ["u"],
  b.binary(">=", b.member(b.param("u"), "age"), b.const(18)),
);
db.users.filter(isAdult); // memory calls compiled; SQL reads body
```

## Where to go next

- [Applications](/guide/applications) — what a serializable, evaluable tree is good for.
- [Writing a provider](/guide/writing-a-provider) — the interface behind every translation target.
- [The tree JSON schema](/reference/tree-schema) — the wire format serialized trees conform to.
