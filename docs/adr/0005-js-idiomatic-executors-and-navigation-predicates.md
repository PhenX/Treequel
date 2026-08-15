# ADR-0005 — JS-idiomatic executors and navigation predicates

Status: accepted

## Context

The executor names came from LINQ (`any`, `all`, `first` that throws, `firstOrNull`), which reads foreign to
JavaScript developers: arrays spell those `some` and `every`, and the dominant TS data libraries (Prisma, Knex) return
`null`/`undefined` from `first`-style finders rather than throwing. Separately, filtering by a relationship —
`WHERE EXISTS (…)` — did not exist: predicates could only touch columns.

## Decision

1. **Executors follow JS, not LINQ.** `any → some`, `all → every` (Array parity); `first` returns `T | null` and
   never throws (Prisma's `findFirst` convention), with `firstOrThrow` as the asserting variant; `firstOrNull` is
   removed. `single` keeps its cardinality-assertion semantics and name. Exec plan kinds rename with the surface
   (`some`/`every`).
2. **Navigation predicates are the same Array methods inside expressions.** `where(u => u.orders?.some(o =>
   o.total > 10))` — the optional chain is the canonical spelling since navigation properties are optional, so
   `Pred<T>` accepts `boolean | undefined` (undefined ≡ false). `every` over an empty navigation is true, exactly
   like `Array.prototype.every`.
3. **Relations ride on the plan.** `QueryPlan` carries the context's `relations` map, so providers resolve
   navigation references in predicate trees with no side channel — consistent with `IncludeSpec` being
   self-contained.
4. **SQL compiles them to correlated subqueries.** `some` → `EXISTS (SELECT 1 FROM child WHERE key AND p)`;
   `every` → `NOT EXISTS (… AND NOT p)` (vacuous truth included). The nested lambda translates in a child scope whose
   lexical parent is the enclosing scope (`TranslateContext.scoped` chains), so inner predicates can reference the
   outer row; `TranslateEnv` supplies relations, schema meta and statement-unique aliases.
5. **Memory attaches, then evaluates.** The reference engine derives include specs from the predicate tree
   (`predicateSpecs`), attaches those navigations to aligned row copies, runs `compiled`, and filters the originals —
   results match SQL row for row and attachments never leak into results. This path needs the expression tree; when
   none exists (no plugin, no fallback), a recording-proxy probe detects navigation access in the compiled lambda and
   the engine refuses with a teachable R3001 instead of silently evaluating against absent data. Plain predicates
   remain tree-free.

## Consequences

- Breaking renames across `Queryable`, `ExecKind`, the traced-method lists, docs and tests; pre-0.1, no migration
  path shipped. The conformance corpus gained six navigation-predicate cases; a dedicated memory suite runs them
  through the runtime fallback, and the no-tree refusal is pinned in the plain unit suite.
- `TranslateContext` gained an `env` and a lexical parent chain — additive for dialect authors.
- Selector positions (`select`, `orderBy`, aggregates) do not resolve navigations yet; that is the correlated
  projections roadmap item.
