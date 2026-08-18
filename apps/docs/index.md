---
layout: home
hero:
  name: Greffon
  text: Expression trees for TypeScript
  tagline: "Write an ordinary lambda; it stays the function it always was, and becomes a typed, serializable tree you can evaluate, rewrite, print, store, send over the wire — or hand to a provider that translates it: a policy check, a remote filter, parameterized SQL."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /playground/
      target: _self
    - theme: alt
      text: Applications
      link: /guide/applications
features:
  - title: The tree is the product
    details: A typed, versioned, JSON-serializable algebra with zero dependencies and a public schema. Evaluate it without its function, rewrite it, print it, ship it across a process boundary.
    link: /guide/the-tree
    linkText: The expression tree
  - title: One lambda, two lives
    details: The same query file runs against fixture arrays in your tests and compiles to a parameterized SQL WHERE clause in production. The in-memory provider is the reference semantics; the SQL provider is property-tested against it.
    link: /guide/getting-started
    linkText: Getting started
  - title: Policy checks, wire filters, rules as data
    details: The predicate that filters a list query also authorizes one object, runs in the browser, and serializes into an auditable store — one definition, four jobs.
    link: /guide/applications
    linkText: Applications
  - title: One shared validator
    details: The subset validator, free-variable analysis, and serializer live once and back the build, the editor, the ESLint rule, and the runtime fallback — so they never disagree about what is legal.
    link: /guide/the-subset
    linkText: The expression subset
  - title: Fail fast, never guess
    details: Untranslatable queries are located, coded errors — not silent client-side table scans. Rows cross into JavaScript only at an explicit inMemory() boundary.
    link: /guide/the-boundary-rule
    linkText: The boundary rule
  - title: Next to your stack
    details: Greffon is the query layer, beside whatever owns your schema and writes. Here is how it relates to Prisma, Drizzle, Kysely, TypeORM, MikroORM, EF Core, and the rules engines.
    link: /guide/comparison
    linkText: Compared to ORMs & rules engines
---
