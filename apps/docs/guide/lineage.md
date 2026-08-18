# The C# lineage

Greffon is a TypeScript rebuild of one C# idea: a lambda whose static type decides whether it compiles to a
function or to *data describing the function*. C# has shipped that since 2007; LINQ rests on it, and EF Core is its
largest deployed provider. This page maps what carried over, what EF Core specifically contributed, and where
TypeScript forced a different answer.

## `Expression<Func<…>>`, rebuilt at build time

In C#, the declared type picks what the compiler emits:

```csharp
Func<User, bool>             f = u => u.Age > 18; // compiled code
Expression<Func<User, bool>> e = u => u.Age > 18; // an expression tree
```

TypeScript's compiler has no such seam, so Greffon adds one with a build transform: it finds lambdas at traced call
sites and rewrites each into a literal carrying **both** forms — the original function, untouched, and the tree as
plain data:

```ts
db.users.filter((u) => u.age > minAge);
// ⇣ what the transform emits
db.users.filter(
  __tql_expr$({
    v: 1,
    compiled: (u) => u.age > minAge, // the function it always was
    params: ["u"],
    body: {
      kind: "Binary",
      op: ">",
      left: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "age" },
      right: { kind: "Capture", name: "minAge" },
    },
    scope: () => ({ minAge }),
  }),
);
```

That transform runs in one of two build hosts: a [bundler plugin](/guide/getting-started) (`@greffon/vite`,
covering Vite, Rollup, and Rolldown) for a bundled build, or a
[TypeScript-compiler transformer](/guide/compiling-with-tsc) (`@greffon/ts-transformer`) for a `tsc`-only backend
with no bundler. Both emit the same literal.

`Expr<(u: User) => boolean>` is the counterpart of `Expression<Func<User, bool>>`, and every operator accepts
`F | Expr<F>` — the same pairing C# expresses with the `Func` / `Expression<Func>` overload sets of `Enumerable` and
`Queryable`.

## `IQueryable`, plans, and explicit execution

A LINQ `IQueryable` chain runs nothing — it builds an expression tree that an `IQueryProvider` translates when the
query is enumerated. `Queryable` keeps that split: every operator appends one op to an immutable `QueryPlan`, and a
`QueryProvider` translates the plan when an executor runs.

One deliberate departure: C# executes on enumeration — `foreach`, `ToList()`, a stray `Count()` — and it is easy to
run a query without meaning to. A Greffon `Queryable` is not a thenable and never auto-executes; I/O happens only at
a named executor (`toArray()`, `first()`, `count()`, …). A line that queries the database should look like one.

## Closures become parameters

C# lambdas capture variables by reference and read them when the query runs; EF Core then binds captured values as
SQL parameters instead of pasting them into the statement. Both properties carry over. The emitted
`scope: () => ({ minAge })` thunk reads the live binding at execution time; partial evaluation folds it into the
tree; SQL providers bind it as `$1` / `?`:

```ts
let minAge = 18;
const adults = db.users.filter((u) => u.age > minAge);
minAge = 21;
await adults.toArray(); // WHERE "users"."age" > $1 — with $1 = 21, the value at execution
```

## What EF Core contributed

EF Core is the reference implementation for "LINQ over a real database", and Greffon borrows its answers directly:

- **`include` / `thenInclude`** are EF Core's navigation-loading names and rules — includes attach to result rows and
  are invisible to `filter` in the same query. Greffon always executes them the way EF Core's `AsSplitQuery()` does:
  one batched statement per navigation, so joins never duplicate parents and `take`/`skip` apply to parents alone.
- **`flatMap` is `SelectMany`** — querying through a navigation becomes a join.
- **`.inMemory()` is `AsEnumerable()`, made mandatory.** Pre-Core EF silently finished untranslatable queries on the
  client; the accidental table scans were bad enough that EF Core 3.0 removed the behavior as a breaking change.
  Greffon starts where that story ended: untranslatable residue is a located, coded error, and rows cross into
  JavaScript only at the explicit [`.inMemory()` boundary](/guide/the-boundary-rule).
- **The in-memory implementation is the semantics.** LINQ to Objects defines what the operators mean, and remote
  providers are judged against it. `@greffon/provider-memory` plays the same role — enforced by a property-based
  conformance suite rather than by convention.

## Where TypeScript forced different answers

- **A build step instead of a compiler feature.** The C# compiler builds trees; Greffon's are built by a bundler
  plugin or the `tsc` transformer — or, without either, by a runtime `toString()` fallback that is closure-blind and
  says so ([R3002](/errors#R3002)). What C# gets from the compiler being the single validator, Greffon rebuilds by
  sharing one validator package across the build, the editor plugin, and the ESLint rule.
- **A closed, serializable grammar instead of an open one.** A C# expression tree can reference any .NET method, and
  it does not serialize — it lives and dies in-process. Greffon's tree is a small closed algebra with a versioned
  JSON wire format, because these trees are meant to leave the process: cross to a server, sit in a policy store, be
  translated by third-party providers. A provider can promise translation only over a finite grammar.
- **Different subset lines.** C#'s converter has restrictions of its own — no statement bodies, no assignments, no
  `?.`. [Greffon's subset](/guide/the-subset) is the same idea with the lines drawn for cross-provider meaning, and
  optional chaining is *inside* it, because navigation properties are optional.

## The map

The types and architecture carry across one-to-one:

| C# / .NET                                 | Greffon                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `Expression<Func<User, bool>>`            | `Expr<(u: User) => boolean>`                                          |
| Compiler-built expression trees           | Build-time reification (`@greffon/vite`, `@greffon/ts-transformer`) |
| `IQueryable<T>`                           | `Queryable<T>`                                                        |
| `IQueryProvider`                          | `QueryProvider`                                                       |
| LINQ to Objects                           | `@greffon/provider-memory`                                           |
| `ExpressionVisitor`                       | The visitor / rewriter in `@greffon/core`                            |
| `Include` / `ThenInclude`, `AsSplitQuery` | `include` / `thenInclude` (always split)                              |

## Operators, three ways

LINQ named its operators after SQL (`Where`, `Select`). Greffon names them after the JavaScript `Array` methods they
mirror, because the same lambda already runs against a plain array in the memory provider — so a query reads the way
the equivalent array transform reads. The LINQ name is kept in the last column for anyone arriving from C#:

| Greffon                                 | JavaScript `Array`                            | LINQ (C#)                         |
| ---------------------------------------- | --------------------------------------------- | --------------------------------- |
| `filter(p)`                              | `Array.prototype.filter`                      | `Where`                           |
| `map(s)`                                 | `Array.prototype.map`                         | `Select`                          |
| `flatMap(nav)`                           | `Array.prototype.flatMap`                     | `SelectMany`                      |
| `orderBy(k)` / `orderByDescending(k)`    | `Array.prototype.sort` (by a key)             | `OrderBy` / `OrderByDescending`   |
| `thenBy(k)` / `thenByDescending(k)`      | a stable `sort` on the previous key           | `ThenBy` / `ThenByDescending`     |
| `take(n)` / `skip(n)`                    | `slice(0, n)` / `slice(n)`                    | `Take` / `Skip`                   |
| `distinct()`                             | `[...new Set(xs)]`                            | `Distinct`                        |
| `groupBy(k)`                             | `Object.groupBy` / `Map.groupBy`              | `GroupBy`                         |
| `join(...)` / `leftJoin(...)`            | hand-written (`Array.join` is string-joining) | `Join` / `GroupJoin`              |
| `include` / `thenInclude`                | — (loads a declared navigation)               | `Include` / `ThenInclude`         |

The executors — the terminal calls that actually run the query — follow the same rule:

| Greffon                     | JavaScript `Array`                    | LINQ (C#)                       |
| ---------------------------- | ------------------------------------- | ------------------------------- |
| `some(p?)`                   | `Array.prototype.some`                | `Any`                           |
| `every(p)`                   | `Array.prototype.every`               | `All`                           |
| `first(p?)` → `T \| null`    | `Array.prototype.find`                | `FirstOrDefault`                |
| `firstOrThrow(p?)`           | —                                     | `First`                         |
| `single(p?)`                 | —                                     | `Single`                        |
| `count(p?)`                  | `Array.prototype.length`              | `Count`                         |
| `sum(s)`                     | `Array.prototype.reduce`              | `Sum`                           |
| `min(s)` / `max(s)`          | `Math.min` / `Math.max` over the keys | `Min` / `Max`                   |
| `avg(s)`                     | `reduce` ÷ `length`                   | `Average`                       |
| `toArray()`                  | `[...xs]`                             | `ToList` / `ToArray`            |
| `.inMemory()`                | — (crosses into the array world)      | `AsEnumerable`                  |

Three names deliberately keep a non-`Array` spelling, because no array method carries the same meaning: `orderBy` takes
a key selector and sorts stably across levels rather than mutating in place like `sort`; `groupBy` returns `Grouping`
values (and predates `Object.groupBy`); and `join` is the relational join, since `Array.prototype.join` already means
string concatenation. The executor names were settled first — `some`/`every` over LINQ's `Any`/`All`, and a nullable
`first` over a throwing one — and `filter`/`map` extend that same JS-first convention to the operators.

What Greffon does **not** rebuild is the rest of EF Core: no `DbContext` change tracking, no `SaveChanges`, no
migrations, no write path at all. That split is deliberate — [Compared to ORMs & rules engines](/guide/comparison) covers
it.
