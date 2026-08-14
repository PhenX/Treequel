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
      text: The subset
      link: /guide/the-subset
    - theme: alt
      text: Error reference
      link: /errors
features:
  - title: One lambda, two lives
    details: The same query file runs against fixture arrays in your tests and compiles to a parameterized SQL WHERE clause in production. The in-memory provider is the reference semantics; the SQL provider is property-tested against it.
  - title: A small closed tree
    details: The wire format is a versioned, JSON-serializable algebra with zero dependencies. Providers are pure translators over a finite grammar — SQL first, then anything.
  - title: One shared validator
    details: The subset validator, free-variable analysis, and serializer live once and back the build, the editor, the ESLint rule, and the runtime fallback — so they never disagree about what is legal.
  - title: Closure capture
    details: Free variables in a lambda are captured live, like C# closures. `u => u.age > minAge` folds `minAge` into a bound `$n` parameter at execution time.
---
