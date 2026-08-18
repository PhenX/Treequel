# ADR-0014 — Computed members

Status: accepted

## Context

A row type often has values that are *derived* from its columns rather than stored: whether a user is an adult, a
formatted display name, an order's net total after a rate. Written as an ordinary getter or method they run fine in
memory, but they are invisible to a query — `db.users.filter((u) => u.isAdult)` fails, because `isAdult` is not a
column a provider can translate.

C#'s [`EntityFrameworkCore.Projectables`](https://github.com/koenbeuk/EntityFrameworkCore.Projectables) solves this by
inlining a member's definition into the query's expression tree before translation. Greffon already has every piece
that needs: a closed tree algebra, `partialEval`, `rewrite`/`mapChildren`, `makeExpr` to turn a tree back into an
executable `Expr`, and the reference memory engine. This ADR is how they fit together.

## Decision

1. **Name: `computed`.** The members are *computed members* — `defineComputed`, the `createContext(provider, { computed })`
   option. This follows the same rule ADR-0013 set for operators (name a thing for its JavaScript equivalent, not its
   SQL or C# one): "computed" is what the JS ecosystem calls a value derived from other state (Vue, MobX, Svelte,
   Knockout). *Projectable* (the C# term) and *virtual* (Mongoose, SQL generated columns) were the alternatives;
   "projectable" is precise but jargon, "virtual" reads as ORM vocabulary the project deliberately avoids ("not an
   ORM"). A one-parameter definition is a **property** (`u.fullName`); an extra parameter makes it a **method**
   (`o.net(0.1)`).

2. **Explicit registration (Mode A first).** Definitions are registered per context, like relations, via
   `defineComputed<Schema>({ users: { isAdult: (u) => u.age >= 18 } })`, and bodies are reified exactly like any query
   lambda — by the build plugin, `expr()`, or `makeExpr`. A transform-assisted `@computed` class-member marker (which
   would reify a getter/method body and stamp a resolved key on the tree — a wire-format change) is deliberately left
   for later; the explicit registry ships the whole mechanism with no `FORMAT_VERSION` bump.

3. **Expansion at the query layer, once, for every provider.** `expandComputed(plan, meta)` inlines each referenced
   member into the plan's expressions before the provider ever runs, so a provider receives a plan whose trees are
   already ordinary column expressions — memory (which runs `compiled`) and SQL (which reads `body`) both work with no
   per-provider code. This departs from the first sketch, which ran expansion inside each provider's normalize step:
   doing it once in `linq` (where `relations` and the capability pre-check already live) is DRY, keeps providers
   unaware of computed members, and means a third-party provider inherits the feature for free. `explain()` expands
   too, so the printed plan/SQL is never a surprise.

4. **Inlining is capture-avoiding and composable.** For each referenced member: `partialEval` folds the definition's
   own captures (a config constant, a global) to constants, its receiver/argument parameters are substituted with the
   actual subtrees (respecting inner-lambda shadowing), and the result is expanded again so a computed member may be
   defined in terms of another. A set of in-progress `source.member` keys catches cycles (**R2009**); a method called
   with the wrong number of arguments is **R2010**. An untranslatable body surfaces as the provider's ordinary
   `R2001`/`R2002` at translate time — no new "untranslatable member" code.

5. **Source-shaped rows only.** A member is inlined only when its receiver is a lambda parameter whose source is known
   — the query's element source, tracked op by op and dropped to unknown after a `map`/`groupBy`/`join` reshapes the
   row (the same boundary `elementSource` already tracks). Computed members read cleanly on the rows a source hands
   you; past a projection that changes the shape they are left untouched rather than guessed at.

## Consequences

- New public surface in `@greffon/linq`: `defineComputed`, `SchemaComputed<S>`, `ComputedMeta`, and the
  `ContextOptions.computed` option. The registry rides the context but never the `QueryPlan` — providers only see the
  inlined result — so no wire format changes and `FORMAT_VERSION` is untouched.
- Two appended diagnostics, R2009 (cycle) and R2010 (method arity). Codes are append-only; each has a throwing test.
- The conformance corpus gains a `computedCases()` block wired into `runConformance` with a `sampleComputed` registry,
  so memory ≡ Postgres ≡ SQLite is proven for computed properties, composition, and a computed method with an argument
  on every provider that runs the default corpus.
- Deferred, in rough order: the `@computed` class-member marker + body reification + tree stamping (a versioned
  format change); resolving receivers through navigations (`o.user.fullName`), which needs a join/subquery the current
  source-shaped restriction sidesteps; computed members inside `groupBy` aggregates.
