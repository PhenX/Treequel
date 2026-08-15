# Compared to ORMs & EF Core

Treequel is not an ORM, so "Treequel vs. X" is mostly a question of which layer each tool owns. This page places it
next to the tools people usually arrive from — Prisma, Drizzle, Kysely, TypeORM, MikroORM, and .NET's EF Core — and
is explicit about what Treequel does not do.

## The same query, seven ways

A filter, a projection, and an ordering, written in each:

::: code-group

```ts [Treequel]
const adults = await db.users
  .where((u) => u.age >= 18 && u.name.startsWith("A"))
  .select((u) => ({ id: u.id, name: u.name }))
  .orderBy((u) => u.name)
  .toArray();
```

```csharp [EF Core]
var adults = await db.Users
    .Where(u => u.Age >= 18 && u.Name.StartsWith("A"))
    .Select(u => new { u.Id, u.Name })
    .OrderBy(u => u.Name)
    .ToListAsync();
```

```ts [Prisma]
const adults = await prisma.user.findMany({
  where: { age: { gte: 18 }, name: { startsWith: "A" } },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
});
```

```ts [Drizzle]
const adults = await db
  .select({ id: users.id, name: users.name })
  .from(users)
  .where(and(gte(users.age, 18), like(users.name, "A%")))
  .orderBy(users.name);
```

```ts [Kysely]
const adults = await db
  .selectFrom("users")
  .select(["id", "name"])
  .where("age", ">=", 18)
  .where("name", "like", "A%")
  .orderBy("name")
  .execute();
```

```ts [TypeORM]
const adults = await repo.find({
  select: { id: true, name: true },
  where: { age: MoreThanOrEqual(18), name: Like("A%") },
  order: { name: "ASC" },
});
```

```ts [MikroORM]
const adults = await em.find(
  User,
  { age: { $gte: 18 }, name: { $like: "A%" } },
  { fields: ["id", "name"], orderBy: { name: "asc" } },
);
```

:::

The shapes sort into three families. Prisma, TypeORM, and MikroORM encode the predicate as a **data object**
(`{ gte: 18 }`, `MoreThanOrEqual(18)`, `{ $gte: 18 }`). Drizzle and Kysely build **SQL syntax in TypeScript**
(`gte(users.age, 18)`, `.where("age", ">=", 18)`). EF Core and Treequel write an **ordinary lambda over the row**,
which the C# compiler — or Treequel's build plugin — also turns into an expression tree.

The lambda family has one property the other two cannot offer: the predicate is still a function.
`u => u.age >= 18 && u.name.startsWith("A")` runs as-is against plain objects — which is exactly how the memory
provider executes it, and why the same query file works under your test runner with no database and no mocks.

## What each tool owns

|                    | Queries are written as                             | Schema & migrations                         | Change tracking                    | Writes               | Same query on plain arrays |
| ------------------ | -------------------------------------------------- | ------------------------------------------- | ---------------------------------- | -------------------- | -------------------------- |
| **Treequel**       | TS lambdas, reified to trees at build time         | none — table/column mapping only            | none                               | none — queries only  | yes — the reference provider |
| **EF Core** (.NET) | C# lambdas, compiled to trees                      | included                                    | yes — `DbContext` + `SaveChanges`  | yes                  | yes — LINQ to Objects      |
| **Prisma**         | data objects to a generated client                 | `schema.prisma` + `prisma migrate`          | no — stateless client              | yes                  | no                         |
| **Drizzle**        | SQL-shaped builder over a TS schema                | TS schema + `drizzle-kit`                   | no                                 | yes                  | no                         |
| **Kysely**         | typed SQL builder over an interface                | migration runner; types by hand or codegen  | no                                 | yes                  | no                         |
| **TypeORM**        | find-options objects, or a string query builder    | decorators + migrations                     | no — `save()`-based persistence    | yes                  | no                         |
| **MikroORM**       | data objects (Mongo-style operators)               | decorators / `EntitySchema` + migrations    | yes — unit of work + identity map  | yes                  | no                         |

"Plain arrays" means fixture objects with no engine at all — an in-memory SQLite or PGlite still exercises a
database. Treequel's memory provider evaluates the same lambda the query was written with, and it is the reference
semantics every SQL provider is property-tested against.

## The part only expression trees provide

Every tool above turns its query representation into SQL. Treequel's difference is that the representation is a
**typed, versioned, JSON-serializable tree** with a public schema — an artifact, not an implementation detail:

- It crosses process boundaries. The same predicate can travel to a server as a remote filter, sit in a store as an
  auditable policy rule, or be replayed later — `serialize` / `deserialize` are part of `@treequel/tree`'s contract,
  wire format versioned like any other format.
- Anyone can translate it. A provider is a pure function over a closed grammar
  ([Writing a provider](/guide/writing-a-provider)); Postgres and SQLite are the first two targets, not a feature
  list.
- EF Core has the tree too — but as an in-process .NET object graph with no wire format; serializing one is a
  third-party exercise. In Treequel, serialization is the point.

## What Treequel deliberately does not do

Stated plainly, because the table compresses it:

- **No writes.** There is no `insert`, `update`, `delete`, or `save`. Pair Treequel with whatever owns writes — your
  driver, Kysely, Drizzle, an ORM.
- **No schema ownership.** Providers take mapping metadata (`{ users: { table: "users" } }`); nothing generates or
  migrates tables.
- **No connections.** Providers take an `executor` function; pooling, transactions, and configuration stay with your
  driver.
- **No change tracker, no identity map, no caches.** Rows are plain objects; two queries returning the same row give
  you two objects.
- **Pre-0.1.** The tools above have years of production use behind them; Treequel is new, and says so.

## Choosing

- You want one tool to own schema, migrations, and writes → Prisma, Drizzle, TypeORM, or MikroORM.
- You want SQL's shape visible in TypeScript → Kysely or Drizzle.
- You are on .NET → EF Core is this whole design, native to the platform.
- You want query lambdas that run against fixtures in tests and compile to parameterized SQL in production, and
  predicates that serialize into trees a provider can translate → Treequel, next to whatever owns your writes.

These compose rather than compete: nothing stops reads through Treequel and writes through the ORM that owns your
schema, over the same tables. Where the ideas themselves come from is its own story —
[The C# lineage](/guide/lineage).
