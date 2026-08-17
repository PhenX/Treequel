# Queries & executors

A query is an immutable chain: a context names the sources, operators describe the result, and nothing touches the
provider until an **executor** runs. This page is the whole single-source surface — the operators, the executors, and
`explain()`. Queries over more than one source are in [Joins & includes](/guide/joins-and-includes); bucketing rows is
in [Grouping & aggregates](/guide/grouping).

## Contexts

`createContext` binds a schema to a provider. Property access on the context (`db.users`) is a `Queryable`; the
options carry [relations](/guide/joins-and-includes#includes) for `include`/`flatMap` and
[computed members](/guide/computed-members):

```ts
import { createContext } from "@treequel/query";

const db = createContext<{ users: User; orders: Order }>(provider, { relations, computed });
```

The lambdas you pass to operators are expression lambdas — reified by the build plugin, checked against
[the expression subset](/guide/the-subset).

## Operators

Every operator returns a **new** query; the one it was called on is unchanged. Names follow the `Array` methods they
mirror, so a query reads like the equivalent array transform:

| Operator | Meaning |
| --- | --- |
| `filter(p)` | Keep the rows the predicate accepts. |
| `map(s)` | Project each row through a selector. |
| `orderBy(k)` / `orderByDescending(k)` | Sort by a key selector; chain `thenBy(k)` / `thenByDescending(k)` for further levels. |
| `take(n)` / `skip(n)` | Page: the first `n` rows, or everything after the first `n`. |
| `distinct()` | Drop duplicate rows — value equality, so two structurally equal objects are one row. |
| `groupBy(k)` | Bucket rows by key — [Grouping & aggregates](/guide/grouping). |
| `join` / `leftJoin` / `flatMap` / `include` | Combine sources — [Joins & includes](/guide/joins-and-includes). |
| `inMemory()` | Cross into client-side evaluation — [The boundary rule](/guide/the-boundary-rule). |

Sorting is stable across levels, and null keys order the same everywhere: last when ascending, first when descending —
the memory reference and the SQL providers agree row for row.

Because chains are immutable values, a prefix is reusable:

```ts
const active = db.users.filter((u) => u.active);

const names = await active.orderBy((u) => u.name).map((u) => ({ name: u.name })).toArray();
const total = await active.count();
```

## Executors

A `Queryable` is not a promise and never runs on its own — I/O happens only at a named executor, so a line that
queries the database looks like one. Row executors:

| Executor | Returns |
| --- | --- |
| `toArray()` | All rows. |
| `first(p?)` | The first matching row, or `null` — never throws on an empty result. |
| `firstOrThrow(p?)` | The first matching row; throws when there is none. |
| `single(p?)` | Exactly one matching row; throws on zero or more than one. |

Value executors:

| Executor | Returns |
| --- | --- |
| `count(p?)` | Number of matching rows. |
| `some(p?)` | `true` when any row matches. |
| `every(p)` | `true` when every row matches — `true` on an empty result, like `Array.prototype.every`. |
| `sum(s)` | Sum of the selected values; `0` on an empty result. |
| `min(s)` / `max(s)` / `avg(s)` | The extreme or mean of the selected values; `null` on an empty result. |

The optional predicate is shorthand for a final `filter`: `db.users.count(u => u.active)` is
`db.users.filter(u => u.active).count()`.

```ts
const page = await db.users.orderBy((u) => u.name).skip(20).take(10).toArray();
const oldest = await db.users.max((u) => u.age); // number | null
const ada = await db.users.single((u) => u.name === "Ada"); // throws unless exactly one
```

A query is also async-iterable — `for await (const u of active) { … }` fetches the rows once (one `toArray()` under
the hood), then yields them.

## explain()

Every provider answers `explain()` with the text it would run: the SQL providers return the compiled statement (plus
one line per batched `include` fetch), the memory provider returns its op chain. No I/O happens.

```ts
await db.users.filter((u) => u.age >= 18).explain();
// SELECT "users".* FROM "users" WHERE ("users"."age" >= $1)
```

## When a provider can't run an op

Before any I/O, the query checks the provider's declared capabilities and rejects an unsupported op with a located
[R2001](/errors#R2001) — and untranslatable expressions fail the same way, never by silently pulling rows into
JavaScript. [The boundary rule](/guide/the-boundary-rule) covers that contract and the explicit `inMemory()` escape
hatch.

## Where to go next

- [The boundary rule](/guide/the-boundary-rule) — what gets reified, and how untranslatable queries fail.
- [Joins & includes](/guide/joins-and-includes) — combining sources and loading navigations.
- [SQL providers](/guide/sql-providers) — running these queries on Postgres and SQLite.
- [The C# lineage](/guide/lineage) — the same operator tables with the LINQ names, for anyone arriving from .NET.
