# `@treequel/linq` — area guide

Read `plans/DESIGN.md` §9 with this file. The query layer: `Queryable`, the `QueryPlan` providers receive, the
provider protocol, and the reference in-memory engine.

## Operator naming (MUST follow)

Operators and executors are named for their **JavaScript `Array` equivalent** wherever a faithful one exists —
`filter`, `map`, `flatMap`, `some`, `every` — not for LINQ or SQL (ADR-0005, ADR-0013). A chain reads the way the
same transform over a plain array reads, which is exactly what the memory provider runs.

- Three operators keep a non-`Array` name on purpose: `orderBy`/`thenBy` (key selector + stable multi-level sort, not
  `sort`), `groupBy` (returns `Grouping`), and `join`/`leftJoin` (relational join; `Array.prototype.join` is string
  concatenation). Don't rename these to array methods.
- The executors are settled (ADR-0005): `first` returns `T | null`, `firstOrThrow` throws, `single` asserts one;
  `count`/`sum`/`min`/`max`/`avg` are the aggregates. Adding an operator with a faithful array twin? Use that name.
- The `apps/docs/guide/lineage.md` three-column table (Treequel · `Array` · LINQ) is the reference for the parallel —
  update it in the same change when the surface changes.

## The plan-op kind matches the surface name

A surface method appends a plan op whose `op` string **is** the method name (`filter()` → `{ op: "filter" }`). When
you rename or add a surface method, the op kind moves with it — and four lists plus every provider must stay in sync:

- `PlanOp` union + `PLAN_OP_KINDS` (`plan.ts`), the memory engine switch (`memory-engine.ts`), `elementSource`.
- `SUPPORTED_OPS` in `@treequel/sql-core` and the `foldOp` switch; the include-refinement op check.
- The traced-method sets (`QUERY_METHODS`) duplicated in `@treequel/transform`, `@treequel/eslint-plugin` and
  `@treequel/ts-plugin` — a lambda argument is only reified at a call whose method name is in these sets.

Miss one and the failure is silent-ish: an unlisted method's lambda never becomes an `Expr` (it stays an opaque
function), or a provider rejects a plan op it should translate. The conformance corpus (`testing.ts`) is the backstop —
extend it when you add an operator.

## Computed members ride the context, not the plan

`defineComputed` builds a registry (source → member → definition) that rides the context like `relations`, but unlike
`relations` it is **never placed on the `QueryPlan`**. `expandComputed` (in `computed.ts`) inlines every referenced
member into the plan's expressions once, at the query layer — `QueryableImpl.run()` and `.explain()` call it before a
provider ever sees the plan — so providers translate ordinary column trees and stay unaware the feature exists (ADR-0014).

- **Do not** teach a provider about computed members, and do not add a plan-op kind for them — there is none, and no
  wire-format change (the registry is context state, not serialized).
- A one-parameter definition is a **property** (`u.isAdult`); extra parameters make it a **method** (`o.net(0.1)`).
- Inlining happens only on **source-shaped rows**: the receiver must be a lambda param whose source is known, tracked
  op by op exactly as `elementSource` tracks it (unknown after a `map`/`groupBy`/`join`). Keep that restriction unless
  you also teach the resolver to follow navigations.
- Cycles are `R2009`, method-arity mismatches `R2010`. Add computed cases to `computedCases()` in `testing.ts` — it
  feeds the default corpus, so memory ≡ every SQL provider is checked automatically.
