# The boundary rule

Only lambda **literals** written directly at a traced call site — or wrapped in `expr()` — become expression trees. A
plain function value passed by reference does not.

```ts
// reified: a literal at the call site
db.users.where((u) => u.age > 18);

// reified: explicitly wrapped
const adult = expr((u: User) => u.age > 18);
db.users.where(adult);

// NOT reified: an opaque function reference
const adult = (u: User) => u.age > 18;
db.users.where(adult); // → R2003 at a provider that needs the tree
```

A provider that needs a tree rejects an opaque function with [R2003](/errors#R2003), telling you to inline the lambda
or wrap it with `expr()`. The ESLint rule `treequel/no-opaque-callback` flags this at lint time, before you run.

The in-memory provider accepts opaque functions — it just calls them — so a test can pass while a SQL provider would
reject the same code. That divergence is a warning, not a silent success.

## No silent client-side evaluation

When a query mixes translatable and untranslatable work, Treequel does **not** quietly pull rows into memory to finish
the job. Untranslatable residue is a fail-fast error with a source location. This avoids the accidental full-table
scan that silent client evaluation causes.

When you *do* want part of a query to run in memory, say so with `.inMemory()` — a visible, auditable line. The
provider executes the prefix; everything after the boundary runs on the in-memory provider over the materialized rows,
where any JavaScript is allowed.

```ts
db.users
  .where((u) => u.age > 18) // → SQL
  .inMemory() // rows cross here
  .where((u) => scoreModel(u) > 0.7) // → in memory, arbitrary JS
  .toArray();
```

The capability check runs on the prefix only; opaque functions and unknown calls are legal after the boundary.

## Dates

Most date logic never reaches a provider: compute it in ordinary JavaScript above the query and capture the result,
and partial evaluation folds it to a constant before translation. A captured `Date` binds as one parameter.

```ts
const since = startOfWeek(new Date()); // any JS date library
db.events.where((e) => e.at >= since); // → `at >= $1`
```

For fields of a **column**, the SQL providers translate `getFullYear()`, `getMonth()`, and `getDate()` — to `EXTRACT`
on Postgres, `strftime` on SQLite. `getMonth()` stays 0-based, matching JavaScript. These fields are read in **UTC**, so
they match the in-memory reference when your process runs in UTC; if it does not, cross `.inMemory()` and let the
getters run in JS. Any other `Date` method (`getHours()`, `getDay()`, `toISOString()`, …) is untranslatable — a
located [R2001](/errors#R2001), pointing you at the boundary.
