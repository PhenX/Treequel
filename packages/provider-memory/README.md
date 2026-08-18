# @greffon/provider-memory

The reference provider of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript. It executes a
`QueryPlan` over plain arrays by running the compiled lambdas — `filter` is `Array.prototype.filter` — through the
shared engine in [`@greffon/query`](https://github.com/PhenX/Greffon/tree/main/packages/query). It defines correct
behavior: every other provider is conformance-tested against its results.

Use it in tests and fixtures with the same query files that compile to SQL in production. Plain lambdas need no build
plugin here — the provider calls the function; only navigation predicates (`u.orders?.some(…)`) read the tree.

## Install

```
npm install @greffon/provider-memory
```

## Usage

```ts
import { createContext } from "@greffon/query";
import { memoryProvider } from "@greffon/provider-memory";

interface User { id: number; name: string; age: number; active: boolean }

const users: User[] = [
  { id: 1, name: "Ada", age: 36, active: true },
  { id: 2, name: "Bob", age: 17, active: true },
];

const db = createContext<{ users: User }>(memoryProvider({ users }));

const adults = await db.users
  .filter((u) => u.age >= 18 && u.active)
  .map((u) => ({ id: u.id, name: u.name }))
  .toArray(); // [{ id: 1, name: "Ada" }]
```

Hand the same chain a SQL provider instead and it compiles to one parameterized statement — swap the provider, keep
the query file.

## API

- `memoryProvider(data)`: a `QueryProvider` over arrays keyed by source name. It supports every plan op; a plan naming
  an unknown source is refused with a coded `R2002`. `explain()` returns the op chain, e.g.
  `memory scan: users (filter → map)`.
- `MemoryData`: the fixtures shape, `{ [source]: rows }`.

The semantics every other provider must reproduce are defined here: stable multi-level ordering (nulls last when
ascending, first when descending), value-equality `distinct`, null join keys matching nothing, `every` true on an
empty result. One deliberate looseness: this provider accepts an opaque function reference (it just calls it), where
a SQL provider rejects the same query with `R2003` — a passing in-memory test is not proof a query translates.

## Docs

- [Queries & executors](https://phenx.github.io/Greffon/guide/queries)
- [The boundary rule](https://phenx.github.io/Greffon/guide/the-boundary-rule)
- [Writing a provider](https://phenx.github.io/Greffon/guide/writing-a-provider)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
