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
  capability pre-check before any I/O and fails fast with a located error, so an unsupported op never reaches your
  `execute`.
- `execute(plan)` receives an immutable `QueryPlan` — a `source` and an ordered list of ops (`where`, `select`,
  `orderBy`, `take`, executors, …), each carrying an `Expr`.

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
import { runConformance } from "@treequel/linq/testing";

const results = await runConformance((fixtures) => makeMyProvider(fixtures), { fixtures });
const failures = results.filter((r) => !r.equal);
```

Run this under the build plugin (name the file `*.reify.test.ts` in a Vitest setup) so the queries reify into real
trees. Every divergence the reference finds — LIKE escaping, null ordering, collation — becomes a permanent regression
fixture.

## Values are parameters, not strings

If your target is a query language with injection risk, bind constants as parameters; never interpolate them. The SQL
provider turns every `Constant` into a `$n` placeholder and escapes `%`, `_`, and `\` in `LIKE` patterns.
