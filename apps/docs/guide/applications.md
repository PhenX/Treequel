# Applications

SQL is the first thing Treequel does with an expression tree, not the only thing. Because the tree is a typed,
versioned, JSON value over a closed grammar, the same lambda can filter a database, authorize an object, cross a
process boundary, or sit in a store as data — with [the toolkit](/guide/the-tree) every pattern below uses.

These are patterns the tree enables, not a feature list of shipped packages. What ships today is the toolkit plus
three providers — [memory](/guide/getting-started), [Postgres, and SQLite](/guide/getting-started). Everything else
here is something you build on the tree, most often by [writing a provider](/guide/writing-a-provider) or by calling
`evaluate`/`serialize` directly.

## Authorization and policy

A rule like `(user, doc) => doc.orgId === user.orgId && (!doc.archived || user.role === "admin")` written once as a
tree can do four jobs from one definition: translate into the `WHERE` clause of every list query (row-level filtering
at the database), `evaluate` against a single object for a can-this-user-see-this check, run in the browser to show or
hide UI, and serialize into a policy store to be audited, diffed, and versioned. The dual nature pays twice here —
the same rule is both the filter that lists what you may see and the check on one item.

## Filters and saved searches over the wire

Instead of inventing query parameters or a bespoke filter DSL, a client can send a serialized tree to an endpoint.
The server re-validates it against the closed grammar and then either translates it (a provider) or interprets it
(`evaluate`). The same shape backs a saved search stored as a column and re-run later, and "notify me when something
matches" — where the stored tree runs as SQL for the backfill and as `evaluate` against each new event.

## Rules as data

Feature-flag targeting, alert conditions, pricing and eligibility rules, campaign segmentation — each is a predicate
that a product often wants to edit without a deploy. Because the tree is plain JSON, a no-code rule builder can
round-trip with code: developers write lambdas, an admin UI renders and edits the same trees, and `print` gives a
human-readable audit string. The targeting rule that decides membership also compiles to `COUNT(*)` to size the
cohort.

## Realtime, sync, and off-thread

Tree nodes are `structuredClone`- and `postMessage`-safe by construction, so a predicate can cross into a Web Worker
or an edge runtime where a function cannot, and `evaluate` runs it there without `new Function` (which also keeps it
inside a strict CSP). Subscription filters for pub/sub and partial-replication shapes for sync engines ("replicate the
rows where …") are the same problem: a typed, serializable, server-checkable predicate.

## More translation targets

The [provider protocol](/guide/writing-a-provider) does not assume SQL. A provider is a pure function from the closed
grammar to some target: a document-store filter, a search-engine query, an OData `$filter` string, an IndexedDB key
range. Because the grammar is small, closed, and versioned, a tree interpreter in another language (Go, Rust, Python)
is a modest undertaking — the same rule evaluated by a polyglot backend.

## Typed member selectors

Not every use of an expression tree is a query. In the C# ecosystem, mocking, validation, and object-mapping
libraries use tiny trees just to get a refactor-safe, statically typed path to a member — `x => x.profile.email` as
both a getter and the string `"profile.email"`. TypeScript libraries fake this with string literals and `keyof`
today; a reified selector gives form bindings, table column definitions, and patch builders the real thing. Treequel's
own `include(u => u.orders)` reads a navigation path exactly this way.

## Meta-tooling on your own queries

The tree is inspectable, so your queries become data you can test and transform. Serialize a tree to a canonical
string and use it as a cache key. Assert on structure in a test — "this endpoint's query filters by `orgId`" — against
the tree, not a brittle SQL string. Use `rewrite` to fold a tenant filter or a soft-delete predicate into every query
from one place. Log trees and analyze which fields real queries touch to inform indexing.

## Where to go next

- [The expression tree](/guide/the-tree) — the toolkit these patterns use: `evaluate`, `serialize`, `rewrite`, `b`,
  `makeExpr`.
- [Writing a provider](/guide/writing-a-provider) — the interface behind every non-SQL translation target above.
- [The boundary rule](/guide/the-boundary-rule) — how `evaluate`-in-memory and translate-to-a-backend compose in one
  query.
