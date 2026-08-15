# Joins & includes

Two ways to combine sources: `join`/`leftJoin` project a new row shape from two sides, EF-style
`include`/`thenInclude` load related rows onto the rows you already have. Both run against fixture arrays in tests and
compile to SQL in production, with one set of semantics.

## Inner and left joins

`join` matches rows by key and hands both to a result selector. `leftJoin` keeps every outer row; the inner side is
`null` when nothing matched — the parameter type says so, and strict TypeScript makes the projection handle it, which
is exactly what SQL's `NULL` propagation produces.

```ts
const lines = await db.orders
  .join(
    db.users,
    (o) => o.userId,
    (u) => u.id,
    (o, u) => ({ order: o.id, who: u.name }),
  )
  .toArray();

const all = await db.orders
  .leftJoin(
    db.users,
    (o) => o.userId,
    (u) => u.id,
    (o, u) => ({ order: o.id, who: u?.name ?? null }),
  )
  .toArray();
```

- **Null keys never match.** A `null`/`undefined` join key (or a composite key with a null member) joins to nothing,
  on every provider — the SQL rule, mirrored by the in-memory reference. Under `leftJoin` such rows survive with a
  `null` partner.
- **Composite keys** are object literals with the same properties on both sides:
  `(o) => ({ a: o.x, b: o.y })` / `(u) => ({ a: u.x, b: u.y })`.
- **The inner side is a full query.** Filter it first (`db.orders.where(...)`) and the SQL provider joins a derived
  table.
- **Everything composes.** `where`/`orderBy`/`select`/`take` after a join operate on the projected shape; the SQL
  provider wraps the join in a derived table when SQL evaluation order requires it.

Limits (v1): the join result selector must be an object literal (or a single scalar) when it compiles to SQL — a bare
row (`(o, u) => u`) is not a projection. `groupBy` after a join stays memory-only.

## Includes

`include` loads a declared navigation with the query; `thenInclude` goes one level deeper. Related rows attach to the
final result rows — the navigation property becomes required and non-null in the result type.

```ts
const users = await db.users
  .include((u) => u.orders)
  .thenInclude((o) => o.items)
  .where((u) => u.active)
  .orderBy((u) => u.name)
  .toArray();

users[0].orders; // Order[] — loaded, no longer optional
```

Navigations are declared once, next to the schema, and passed to the context:

```ts
interface User  { id: number; name: string; orders?: Order[] }
interface Order { id: number; userId: number; user?: User | null; items?: Item[] }
interface Item  { id: number; orderId: number; sku: string }

const relations = defineRelations<Schema>({
  users:  { orders: { kind: "many", target: "orders", from: "id", to: "userId" } },
  orders: {
    user:  { kind: "one",  target: "users", from: "userId", to: "id" },
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
});

const db = createContext<Schema>(provider, { relations });
```

Declare navigation properties as optional on the row types; `kind: "many"` attaches an array (empty when there are no
children), `kind: "one"` attaches a row or `null`. `defineRelations` typechecks every name: the navigation must be a
property of the declaring row, `target` a schema source, `from`/`to` keys of the respective rows.

### How they execute

SQL providers run includes as **split queries**: one batched fetch per navigation
(`WHERE "userId" = ANY($1)` on Postgres, a chunked `IN (…)` on SQLite), stitched onto the parents in memory. Parent
rows are never duplicated by a join, take/skip apply to parents alone, and a query with two navigations costs exactly
three statements. `explain()` lists the batched fetches under the root SQL.

### The rules

- **Selectors are navigation paths, not expressions.** `include(u => u.orders)` — a single property access. It is
  read by probing the function; it is never captured, so it works with or without the build plugin.
- **Includes attach to the final rows**, wherever they appear in the chain. They are not visible to `where`/`select`
  of the same query — filter on columns, not on loaded navigations (as in EF Core).
- **The parent key must survive.** After a `select`, the rows must still carry the `from` property or the include
  fails with R2002.
- **Attachment order is canonical** (a deterministic JSON-based order), because SQL row order without `ORDER BY` is
  undefined. Sort in your own code if you need a specific child order.
- Scalar executors (`count`, `sum`, …) ignore includes; `first`/`single`/`toArray` attach them.
- An unknown navigation is R2007; a selector that is not a single property access, or a `thenInclude` that does not
  follow an `include`, is R2008.
