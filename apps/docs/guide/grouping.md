# Grouping & aggregates

`groupBy` buckets rows by a key; a `map` over the groups projects the key and *measures* the bucket — with the
JS that `Grouping`'s real `items` array already supports:

```ts
const perUser = await db.orders
  .groupBy((o) => o.userId)
  .map((g) => ({
    userId: g.key,
    n: g.items.length,                                             // COUNT(*)
    big: g.items.filter((o) => o.total > 100).length,              // COUNT(CASE WHEN …)
    total: g.items.reduce((acc, o) => acc + o.total, 0),           // SUM(total)
    low: g.items.reduce((m, o) => Math.min(m, o.total), Infinity), // MIN(total)
    high: g.items.reduce((m, o) => Math.max(m, o.total), -Infinity), // MAX(total)
    avg: g.items.reduce((acc, o) => acc + o.total, 0) / g.items.length, // SUM / COUNT
  }))
  .filter((r) => r.n > 1)          // HAVING semantics — filters the groups
  .orderByDescending((r) => r.total)
  .take(10)
  .toArray();
```

- The same query runs on the memory reference (`g.items` is a plain array; every idiom is native JS) and compiles to
  one `GROUP BY` statement on SQL. Averages need no idiom of their own — `sum / count` is ordinary arithmetic.
- **Composite keys** are object literals: `groupBy(o => ({ uid: o.userId, year: … }))`, projected one property at a
  time (`g.key.uid`).
- **Any key works**, including a correlated measurement (`groupBy(u => u.orders?.length ?? 0)`): a non-column key is
  precomputed into a derived table so the grouped statement never re-evaluates it.
- A `filter` *after* the group projection filters groups (SQL wraps the `GROUP BY` in a derived table — `HAVING`
  semantics); `orderBy`/`take`/`skip` compose as usual. `groupBy(...).count()` counts the groups.
- `Math.min`/`Math.max` idioms require their identity seeds (`Infinity`/`-Infinity`) and do not compose with
  `.filter()` — a filtered-empty bucket would be `NULL` in SQL but the seed in JS, so it is refused instead.
- **Materializing raw groups** (`groupBy(...).toArray()` without a projection) stays memory-only: `Grouping` has no
  faithful single-query SQL shape. SQL providers refuse it with R2001; project first.
- Navigations are not resolvable inside group aggregates (`g.items.filter(o => o.items?.some(…))` is refused on SQL).

## Where to go next

- [Queries & executors](/guide/queries) — whole-query aggregates (`count`, `sum`, `avg`, …) with no `groupBy` at all.
- [Computed members](/guide/computed-members) — derived properties usable in filters and group keys, before the rows
  are reshaped.
- [The boundary rule](/guide/the-boundary-rule) — why the refusals above are located errors, never silent fallbacks.
