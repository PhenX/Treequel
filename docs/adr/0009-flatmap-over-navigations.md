# ADR-0009 — flatMap over navigations

Status: accepted

## Context

EF Core's `SelectMany` expands a row through a collection navigation; nothing in the query layer flattened. On arrays
JS spells this `flatMap`, so the queryable should too (the naming convention of ADR-0005).

## Decision

1. **`flatMap(nav)` / `flatMap(nav, result)`.** The navigation is resolved like `include` (probed selector, relations
   map). Without a result selector the elements *become* the related rows; with one, `result(parent, child)` shapes
   each pair like a join. Rows whose key is null expand to nothing — SQL join semantics, mirrored by the reference.
2. **The element source follows the flattening.** A new `elementSource(plan)` tracks which table the current rows
   still are: a selectorless `flatMap` advances it to the navigation's target, a `select`/`groupBy`/`join` (and a
   `flatMap` *with* a selector, which reshapes) clears it. `include`/`flatMap` resolve their navigation against
   `elementSource`, so `users.flatMap(u => u.orders).flatMap(o => o.items)`, `.flatMap(u => u.orders).include(o =>
   o.items)`, and navigation predicates after a flatMap all resolve against the right table with no threading.
3. **SQL is an INNER JOIN.** The compiler joins the target on the declared key pair; without a selector the layer
   swaps its row shape to the child table (its navigations stay resolvable — matching the memory element-source
   rule), with a selector the two-parameter projection sets the layer shape like a join. One statement, composing
   with every operator after it.
4. **Memory expands parent-major**, indexing the target by key and emitting children (or the projected pair) in
   parent order — deterministic and matching the join.

## Consequences

- `flatMap` joins the plan ops, the provider supported ops, and the traced-method lists. Seven conformance cases
  (raw expansion, result selector, reference-navigation flatten with null-key skip, two-level chain, composition with
  where/orderBy/take, navigation predicate after flatMap, include after flatMap) run on the memory reference, sql.js
  and PGlite; memory unit tests pin parent-major order and element-source resolution, and the SQLite suite pins the
  INNER JOIN and shape-swap SQL. Type tests pin both overloads.
- Surfaced (not caused) a pre-existing wart: a raw-row `toArray()` over a column-mapped table returns physical column
  names, where the reference returns logical ones. Logged for a follow-up; projections are unaffected.
