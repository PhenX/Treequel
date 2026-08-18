# Computed members

A computed member is a value derived from a row — declared once, in terms of the row, and used inside a query as if it
were a real column:

```ts
db.users.filter((u) => u.isAdult).map((u) => ({ name: u.fullName }));
```

`isAdult` and `fullName` are not columns. Before a provider translates the query, Greffon inlines each member's
definition into the expression tree — `u.isAdult` becomes `(u.age >= 18)`, `u.fullName` becomes
`` `${u.first} ${u.last}` `` — so the inlined tree flows through the ordinary column and operator translation. The same
inlining runs for the memory provider, so a computed member means the same thing in your tests and in SQL.

## Declare them

Register computed members per context, next to the schema, and pass them to `createContext`. A one-parameter
definition is a **property** (`u.isAdult`); an extra parameter makes it a **method** (`o.net(0.1)`).

```ts
import { createContext, defineComputed } from "@greffon/query";

const computed = defineComputed<{ users: User; orders: Order }>({
  users: {
    isAdult: (u) => u.age >= 18,
    fullName: (u) => `${u.first} ${u.last}`,
  },
  orders: {
    net: (o, rate: number) => o.total * (1 - rate),
  },
});

const db = createContext<{ users: User; orders: Order }>(provider, { computed });
```

Declare the members as optional properties on the row type so queries type-check:

```ts
interface User {
  id: number;
  first: string;
  last: string;
  age: number;
  isAdult?: boolean; // computed
  fullName?: string; // computed
}
```

Then use them anywhere an expression is expected — `filter`, `map`, `orderBy`, `count`, an aggregate selector:

```ts
await db.users.filter((u) => u.isAdult).map((u) => ({ name: u.fullName })).toArray();
//                        └─ (u.age >= 18)          └─ (u.first || ' ' || u.last)

await db.orders.filter((o) => o.net(0.1) > 50).toArray();
//                            └─ (o.total * (1 - 0.1)) > 50
```

## Compose them

A computed member may be defined in terms of another on the same source; inlining resolves the whole chain.

```ts
defineComputed<{ users: User }>({
  users: {
    isAdult: (u) => u.age >= 18,
    canCheckout: (u) => u.isAdult && u.verified,
  },
});
```

A member that resolves back to itself is a cycle, reported as **R2009**. A computed method called with the wrong number
of arguments is **R2010**.

## Authoring without the build plugin

Definitions are reified like any query lambda. Under the build plugin the arrows above just work. Without it, wrap each
in `expr()`, or build the tree directly with `makeExpr` — handy for a shared library that ships definitions without
assuming the consumer's build:

```ts
import { b, makeExpr } from "@greffon/core";

const computed = defineComputed<{ users: User }>({
  users: {
    isAdult: makeExpr(["u"], b.binary(">=", b.member(b.param("u"), "age"), b.const(18))),
  },
});
```

## What they can and cannot do

- **Source-shaped rows only.** A member is inlined when its receiver is a row of a known source. After a `map`,
  `groupBy`, or `join` reshapes the row, the element source is unknown, and members are left untouched — declare
  computed members on the source, and reference them before you reshape.
- **The expression subset applies.** A definition is an expression lambda like any other (see
  [The expression subset](/guide/the-subset)); it is validated when reified.
- **A definition must be translatable by the provider.** The inlined tree is translated like hand-written code, so a
  member that reads an undeclared JSON path or calls something the dialect cannot emit fails with the provider's
  ordinary `R2001`/`R2002` — naming the offending access, not the member.
- **`explain()` shows the inlined tree**, so the SQL a computed member compiles to is never hidden.

## Where to go next

- [The boundary rule](/guide/the-boundary-rule) — how untranslatable definitions fail, and the `inMemory()` escape
  hatch.
- [SQL providers](/guide/sql-providers) — the column and JSON mapping the inlined trees compile against.
- [The expression tree](/guide/the-tree) — `makeExpr` and the `b` constructors used above, in full.
