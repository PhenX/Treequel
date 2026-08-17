# Beyond queries

SQL is the first thing Treequel does with an expression tree, not the only thing. The tree is the product: a typed,
versioned, JSON-serializable value with a [public schema](/reference/tree-schema). Once a lambda is a tree, you can
translate it to a backend that is not SQL, ship it across a process boundary, run it directly against plain objects,
rewrite it, print it, or store it — with the same small toolkit every provider uses.

This page is the toolkit first, then the applications it opens up.

## The toolkit

Everything here is in `@treequel/tree` and `@treequel/core` — zero-dependency, and independent of any provider.

| Function | From | What it does |
| --- | --- | --- |
| `serialize(node)` / `deserialize(json)` | `@treequel/tree` | Tree ⇄ a `{ v, root }` JSON envelope. Versioned; refuses trees from a newer format. |
| `evaluate(node, env)` | `@treequel/core` | Interpret a tree against `{ params, scope }` bindings — no compiled function required. |
| `partialEval({ body, scope })` | `@treequel/core` | Fold captured variables and constant subtrees to `Constant`s, leaving a residual tree. |
| `print(node)` | `@treequel/core` | Render a tree back to readable pseudo-source, for logs and audits. |
| `visit(node, fns)` / `rewrite(node, fns)` | `@treequel/core` | Walk a tree, or rebuild it with per-kind replacements. |
| `b` | `@treequel/core` | Terse node constructors, for building a tree by hand (a rule builder, a codegen). |
| `makeExpr(params, body, opts?)` | `@treequel/core` | Wrap a hand-built tree as an `Expr` a query operator accepts; `compiled` defaults to the interpreter over `body`. |

## Using a serialized tree

A tree survives `JSON.stringify` and comes back with `deserialize`. The received tree carries no function — you run
it with `evaluate`, which interprets the closed grammar directly (no `eval`, no `new Function`):

```ts
import { serialize, deserialize } from "@treequel/tree";
import { evaluate, expr } from "@treequel/core";

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
import { partialEval, print } from "@treequel/core";

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
import { b, evaluate } from "@treequel/core";

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
import { b, makeExpr } from "@treequel/core";

const isAdult = makeExpr<(u: User) => boolean>(
  ["u"],
  b.binary(">=", b.member(b.param("u"), "age"), b.const(18)),
);
db.users.filter(isAdult); // memory calls compiled; SQL reads body
```

## What this is good for

The applications below are patterns the tree enables, not a feature list of shipped packages. What ships today is the
toolkit above plus three providers — [memory](/guide/getting-started), [Postgres, and SQLite](/guide/getting-started).
Everything else here is something you build on the tree, most often by
[writing a provider](/guide/writing-a-provider) or by calling `evaluate`/`serialize` directly.

### Authorization and policy

A rule like `(user, doc) => doc.orgId === user.orgId && (!doc.archived || user.role === "admin")` written once as a
tree can do four jobs from one definition: translate into the `WHERE` clause of every list query (row-level filtering
at the database), `evaluate` against a single object for a can-this-user-see-this check, run in the browser to show or
hide UI, and serialize into a policy store to be audited, diffed, and versioned. The dual nature pays twice here —
the same rule is both the filter that lists what you may see and the check on one item.

### Filters and saved searches over the wire

Instead of inventing query parameters or a bespoke filter DSL, a client can send a serialized tree to an endpoint.
The server re-validates it against the closed grammar and then either translates it (a provider) or interprets it
(`evaluate`). The same shape backs a saved search stored as a column and re-run later, and "notify me when something
matches" — where the stored tree runs as SQL for the backfill and as `evaluate` against each new event.

### Rules as data

Feature-flag targeting, alert conditions, pricing and eligibility rules, campaign segmentation — each is a predicate
that a product often wants to edit without a deploy. Because the tree is plain JSON, a no-code rule builder can
round-trip with code: developers write lambdas, an admin UI renders and edits the same trees, and `print` gives a
human-readable audit string. The targeting rule that decides membership also compiles to `COUNT(*)` to size the
cohort.

### Realtime, sync, and off-thread

Tree nodes are `structuredClone`- and `postMessage`-safe by construction, so a predicate can cross into a Web Worker
or an edge runtime where a function cannot, and `evaluate` runs it there without `new Function` (which also keeps it
inside a strict CSP). Subscription filters for pub/sub and partial-replication shapes for sync engines ("replicate the
rows where …") are the same problem: a typed, serializable, server-checkable predicate.

### More translation targets

The [provider protocol](/guide/writing-a-provider) does not assume SQL. A provider is a pure function from the closed
grammar to some target: a document-store filter, a search-engine query, an OData `$filter` string, an IndexedDB key
range. Because the grammar is small, closed, and versioned, a tree interpreter in another language (Go, Rust, Python)
is a modest undertaking — the same rule evaluated by a polyglot backend.

### Typed member selectors

Not every use of an expression tree is a query. In the C# ecosystem, mocking, validation, and object-mapping
libraries use tiny trees just to get a refactor-safe, statically typed path to a member — `x => x.profile.email` as
both a getter and the string `"profile.email"`. TypeScript libraries fake this with string literals and `keyof`
today; a reified selector gives form bindings, table column definitions, and patch builders the real thing. Treequel's
own `include(u => u.orders)` reads a navigation path exactly this way.

### Meta-tooling on your own queries

The tree is inspectable, so your queries become data you can test and transform. Serialize a tree to a canonical
string and use it as a cache key. Assert on structure in a test — "this endpoint's query filters by `orgId`" — against
the tree, not a brittle SQL string. Use `rewrite` to fold a tenant filter or a soft-delete predicate into every query
from one place. Log trees and analyze which fields real queries touch to inform indexing.

## Where to go next

- [Writing a provider](/guide/writing-a-provider) — the interface behind every non-SQL translation target above.
- [The tree JSON schema](/reference/tree-schema) — the wire format these serialized trees conform to.
- [The boundary rule](/guide/the-boundary-rule) — how `evaluate`-in-memory and translate-to-a-backend compose in one
  query.
