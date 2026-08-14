# Example: vite-postgres (the headline)

The `§1.5` success criterion, executable: **one set of query definitions**
([`src/queries.ts`](src/queries.ts)) runs unchanged against an in-memory
provider and against Postgres (PGlite), producing equal results — property
checked in [`src/headline.reify.test.ts`](src/headline.reify.test.ts).

```ts
// queries.ts — provider-agnostic, written once
export const activeAdults = (db: Context<Schema>) =>
  db.users
    .where(expr((u: User) => u.age >= 18 && u.active))
    .select(expr((u: User) => ({ id: u.id, name: u.name })))
    .toArray();

// namesStartingWith captures `prefix` from the closure — the build plugin
// reifies it, and the SQL provider folds it into a `$n` LIKE parameter.
export const namesStartingWith = (db: Context<Schema>, prefix: string) =>
  db.users.where(expr((u: User) => u.name.startsWith(prefix))).toArray();
```

Enable reification with one line ([`vite.config.ts`](vite.config.ts)):

```ts
import { treequel } from "@treequel/vite";
export default { plugins: [treequel()] };
```

Run it:

```bash
npm test -w @treequel-example/vite-postgres
```

The memory provider is the oracle; the SQL provider must match it. That
equality — over reified trees, on real Postgres semantics — is the whole point.
