# ADR-0013 — JS-idiomatic operators: `filter` and `map`

Status: accepted

## Context

ADR-0005 moved the executors off LINQ's vocabulary and onto JavaScript's — `any`/`all` became `some`/`every`, and
`first` became a nullable finder — on the grounds that the query surface is written in ordinary JS and runs unchanged
against a plain array in the memory provider. The row-shaping operators were left behind: `where` and `select` still
carried their LINQ (and SQL) names, so a chain read half in one dialect and half in the other —
`db.users.where(...).map` was impossible even though the memory provider filters with `Array.prototype.filter` and
projects with `Array.prototype.map` underneath.

## Decision

1. **`where` → `filter`, `select` → `map`.** The two operators with an exact `Array.prototype` twin take that twin's
   name. Signatures and semantics are unchanged; only the spelling moves. This completes the direction ADR-0005 set:
   where a faithful array method exists, the operator is named for it (`filter`, `map`, `flatMap`, `some`, `every`).
2. **Plan-op kinds rename with the surface**, exactly as ADR-0005 renamed the exec kinds. `filter()` appends
   `{ op: "filter", … }` and `map()` appends `{ op: "map", … }`; `PLAN_OP_KINDS`, the provider supported-op sets, the
   memory engine's switch, the SQL compiler's fold, and the refined-include op check all move together. The internal
   SQL emitters keep the names of the clauses they build (`foldWhere` emits a `WHERE`, `foldSelect` a `SELECT`) — a
   `filter` op folding into a `WHERE` clause is the translation, stated plainly.
3. **Three operators keep a non-`Array` name, deliberately.** `orderBy`/`orderByDescending`/`thenBy` take a key
   selector and sort stably across levels — not `Array.prototype.sort`'s in-place comparator. `groupBy` returns
   `Grouping` values and predates `Object.groupBy`. `join`/`leftJoin` are the relational joins; `Array.prototype.join`
   already means string concatenation. Naming any of these after an array method would mislead.
4. **The executors are unchanged.** `first`/`firstOrThrow`/`single`/`count`/`sum`/`min`/`max`/`avg` stay as ADR-0005
   settled them; `some`/`every` already followed this convention. The [C# lineage](../../apps/docs/guide/lineage.md)
   page carries the full three-column map — Greffon operator, its `Array` analog, the LINQ name — so the parallel is
   documented rather than folklore.

## Consequences

- Breaking renames across `Queryable` and `IncludeQuery`, the `PlanOp` union, `PLAN_OP_KINDS`, the SQL provider's
  supported-op list, the memory engine, the SQL compiler's `foldOp` cases and the include-refinement translator, and
  the traced-method lists in `transform`, `eslint-plugin` and `ts-plugin` (the shared constant is now `QUERY_METHODS`,
  since the set is no longer LINQ-named). Pre-0.1, no migration path shipped.
- The conformance corpus, the reify/property provider suites, the transform and ts-transformer snapshots, and the docs
  (getting-started, grouping, joins-and-includes, the boundary rule, the ORM comparison, the C# lineage, the README and
  the playground) move in the same change. The diagnostic that rejects a raw group projection now names `map`.
- No wire-format change: `@greffon/tree` serializes `Expr` nodes, not `QueryPlan` op kinds, so `FORMAT_VERSION` is
  untouched. The rename is confined to the query layer and its providers.
