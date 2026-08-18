# @greffon/query

The query layer of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: `Queryable` and its
operators, the immutable `QueryPlan` a provider receives, the provider protocol, and `createContext`. Operators keep
the `Array` names they mirror, so a chain reads like the array transform the reference engine runs.

This package does no I/O. A provider executes the plan —
[`@greffon/provider-memory`](https://github.com/PhenX/Greffon/tree/main/packages/provider-memory) over fixture arrays,
`@greffon/provider-postgres` and `@greffon/provider-sqlite` as parameterized SQL. One query file runs on all three.

## Install

```
npm install @greffon/query
```

## Usage

```ts
import { createContext, defineRelations } from "@greffon/query";

interface User  { id: number; name: string; age: number; active: boolean; orders?: Order[] }
interface Order { id: number; userId: number; total: number }
interface Schema { users: User; orders: Order }

const relations = defineRelations<Schema>({
  users: { orders: { kind: "many", target: "orders", from: "id", to: "userId" } },
});

// Any provider fits: memoryProvider(fixtures) in tests, postgres(executor, schema) in production.
const db = createContext<Schema>(provider, { relations });

const bigSpenders = await db.users
  .filter((u) => u.active && u.orders?.some((o) => o.total > 100))
  .map((u) => ({ id: u.id, name: u.name }))
  .toArray();
```

Every operator returns a new immutable query; nothing runs until an executor. Before any I/O the plan is checked
against the provider's declared capabilities; an unsupported op or untranslatable expression fails with a located,
coded error, never a silent client-side fallback. `.inMemory()` is the explicit escape hatch into client-side JS.

## API

- `Queryable`: `filter`, `map`, `orderBy`/`thenBy` (and `Descending` variants), `take`/`skip`, `distinct`, `groupBy`,
  `join`/`leftJoin`, `flatMap`, `include`/`thenInclude`, `inMemory`; the executors `toArray`, `first`, `firstOrThrow`,
  `single`, `count`, `some`, `every`, `sum`/`min`/`max`/`avg`; and `explain()`, the statement with no I/O run.
- `createContext(provider, { relations, computed })`: `db.users` is a `Queryable<User>`; `queryable` roots one source.
- `defineRelations`: typed navigations behind `include`/`thenInclude`, `flatMap`, and `some`/`every` predicates.
- `defineComputed`: computed properties/methods (`u.isAdult`, `o.net(0.1)`), inlined before a provider sees the plan.
- `QueryPlan` / `PlanOp` / `IncludeSpec`, with `PLAN_OP_KINDS` and `withOp`: the plan a provider receives.
- `QueryProvider` / `Capabilities` / `capabilities`: the protocol — `name`, `capabilities()`, `execute`, `explain?`.
- The shared in-memory engine (`runPlanInMemory`, `applyOps`, `Grouping`) plus include-stitching helpers to reuse.
- `expr` / `isExpr` / `Expr`: re-exported from `@greffon/core` for the common single import.

`@greffon/query/testing` is the provider-author kit: `runConformance` runs a corpus (operators, joins, includes,
grouping, computed members) against your provider and the in-memory reference; sample fixtures, relations, and row
types are included.

## Docs

- [Queries & executors](https://phenx.github.io/Greffon/guide/queries)
- [Joins & includes](https://phenx.github.io/Greffon/guide/joins-and-includes)
- [Computed members](https://phenx.github.io/Greffon/guide/computed-members)
- [Writing a provider](https://phenx.github.io/Greffon/guide/writing-a-provider)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
