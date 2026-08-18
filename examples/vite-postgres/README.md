# Example: vite-postgres (the headline)

The headline promise, executable: **one set of query definitions**
([`src/queries.ts`](src/queries.ts)) runs unchanged against an in-memory
provider and against Postgres (PGlite), producing equal results — property
checked in [`src/headline.reify.test.ts`](src/headline.reify.test.ts).

```ts
// queries.ts — provider-agnostic, written once
export const activeAdults = (db: Context<Schema>) =>
  db.users
    .filter(expr((u: User) => u.age >= 18 && u.active))
    .map(expr((u: User) => ({ id: u.id, name: u.name })))
    .toArray();

// namesStartingWith captures `prefix` from the closure — the build plugin
// reifies it, and the SQL provider folds it into a `$n` LIKE parameter.
export const namesStartingWith = (db: Context<Schema>, prefix: string) =>
  db.users.filter(expr((u: User) => u.name.startsWith(prefix))).toArray();
```

Enable reification with one line ([`vite.config.ts`](vite.config.ts)):

```ts
import { greffon } from "@greffon/vite";
export default { plugins: [greffon()] };
```

Run it:

```bash
npm test -w @greffon-example/vite-postgres
```

Lint the query lambdas the way a consumer would — [`.oxlintrc.json`](.oxlintrc.json)
turns on the shared subset rules (`greffon/valid-expression`,
`greffon/no-opaque-callback`), test files opted out:

```bash
npm run lint -w @greffon-example/vite-postgres
```

The Vite plugin is the gate a build cannot skip; these lint rules run the same
subset check earlier, as editor and CI feedback.

The memory provider is the reference; the SQL provider must match it. That
equality — over reified trees, on real Postgres semantics — is the whole point.
