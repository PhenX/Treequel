# Writing a provider

A provider is a pure translator over the closed tree grammar. Third-party providers are the point of the project —
SQL is the first, not the only one.

## The interface

```ts
interface QueryProvider {
  readonly name: string;
  capabilities(): Capabilities;
  execute<T>(plan: QueryPlan, signal?: AbortSignal): Promise<T>;
  explain?(plan: QueryPlan): Promise<string>;
}
```

- `capabilities()` declares which plan ops (and, optionally, which WellKnown calls) you translate. `Queryable` runs a
  capability pre-check before any I/O — recursively through `join`/`leftJoin` inner plans — and fails fast with a
  located error, so an unsupported op never reaches your `execute`.
- `execute(plan)` receives an immutable `QueryPlan` — a `source` and an ordered list of ops (`where`, `select`,
  `orderBy`, `take`, `join`/`leftJoin` with a nested inner plan, executors, …), each carrying an `Expr`.
- An `include` op carries a self-contained `IncludeSpec` — navigation name, target source, key pair, cardinality,
  nested children. Providers never read relation metadata; everything needed to fetch and attach is in the spec.

## Implementing includes

Fetch related rows however your backend likes (the SQL core batches
`WHERE key = ANY(…)` per navigation); the key collection, grouping, copy-on-attach, and the canonical child order all
live in shared helpers so every provider agrees on the result shape:

```ts
import { collectIncludes, collectKeys, attachChildren } from "@treequel/linq";

const specs = collectIncludes(plan.ops); // merged across repeated include()
const keys = collectKeys(parents, spec.from, spec.nav); // distinct, non-null
const stitched = attachChildren(parents, spec, children, spec.from, spec.to);
```

Attach only for row-shaped executors (`toArray`, `first`, `single`); scalar executors ignore includes.

## Partial-evaluate first, then translate

Always fold captures before translating. `partialEval` resolves the live closure and collapses every param-free
subtree to a `Constant`, leaving a residual tree of param-rooted data access, constants, and operations over them.

```ts
import { partialEval } from "@treequel/core";

const residual = partialEval({ body: op.expr.body, scope: op.expr.scope });
```

After folding, translation is a walk over a finite node set. Reject what you can't translate with a coded error that
names your provider and the offending call — never a guess, never a silent client-side fallback.

## Conformance: the memory provider is the reference

The in-memory provider defines correct behavior. Your provider must produce the same results. The provider-author kit
ships a conformance harness:

```ts
import { defaultRelations, runConformance } from "@treequel/linq/testing";

const results = await runConformance((fixtures) => makeMyProvider(fixtures), {
  fixtures, // users / orders / items arrays
  relations: defaultRelations(), // the corpus include cases resolve against these
});
const failures = results.filter((r) => !r.equal);
```

The corpus queries are wrapped in `expr()`, so they reify into real trees whenever the module runs under the build
plugin — trace `@treequel/core` in the plugin's `packages` option, or `import "@treequel/fallback/register"` when no
build step runs the tests. Every divergence the reference finds — LIKE escaping, null ordering, collation, null join
keys — becomes a permanent regression fixture.

## Values are parameters, not strings

If your target is a query language with injection risk, bind constants as parameters; never interpolate them. The SQL
provider turns every `Constant` into a `$n` placeholder and escapes `%`, `_`, and `\` in `LIKE` patterns.
