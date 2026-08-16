---
layout: home
hero:
  name: Treequel
  text: Expression trees and LINQ for TypeScript
  tagline: Write an ordinary lambda; it stays the function it always was, and becomes a typed, serializable expression tree that providers translate to SQL, remote filters, policy checks — or anything else. Not an ORM.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /playground/
      target: _self
    - theme: alt
      text: The subset
      link: /guide/the-subset
features:
  - title: One lambda, two lives
    details: The same query file runs against fixture arrays in your tests and compiles to a parameterized SQL WHERE clause in production. The in-memory provider is the reference semantics; the SQL provider is property-tested against it.
    link: /guide/getting-started
    linkText: Getting started
  - title: A small closed tree
    details: The wire format is a versioned, JSON-serializable algebra with zero dependencies. Providers are pure translators over a finite grammar — SQL first, then anything.
    link: /guide/beyond-queries
    linkText: Beyond queries
  - title: One shared validator
    details: The subset validator, free-variable analysis, and serializer live once and back the build, the editor, the ESLint rule, and the runtime fallback — so they never disagree about what is legal.
    link: /guide/the-subset
    linkText: The expression subset
  - title: Closure capture
    details: Free variables in a lambda are captured live, like C# closures. `u => u.age > minAge` folds `minAge` into a bound `$n` parameter at execution time.
    link: /guide/lineage
    linkText: The C# lineage
  - title: Fail fast, never guess
    details: Untranslatable queries are located, coded errors — not silent client-side table scans. Rows cross into JavaScript only at an explicit inMemory() boundary.
    link: /guide/the-boundary-rule
    linkText: The boundary rule
  - title: Not an ORM
    details: No migrations, no change tracker, no writes — Treequel is the query layer, next to whatever owns your schema. Here is how it relates to Prisma, Drizzle, Kysely, TypeORM, MikroORM, and EF Core.
    link: /guide/comparison
    linkText: Compared to ORMs & EF Core
---
