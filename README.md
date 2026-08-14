# Treequel

> Trees in, queries out. The sequel is trees.

**Expression trees and LINQ for TypeScript.** Write an ordinary lambda; it stays the function it always was, and
becomes a typed, serializable expression tree that providers translate to SQL, remote filters, policy checks — or
anything else. The same query file runs against fixture arrays in your tests and compiles to parameterized SQL in
production. Expression trees are the product; LINQ is the flagship application. Not an ORM.

```ts
const adults = await db.users
  .where(u => u.age >= minAge && u.name.startsWith(prefix))
  .select(u => ({ id: u.id, name: u.name }))
  .toArray();
```

## Status

Pre-0.1, under initial construction — nothing is published to npm yet. The API shown above is the design target, not
a released surface.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, checks, commit conventions
- [AGENTS.md](AGENTS.md) — repository structure and the conventions that apply to every change

## License

[MIT](LICENSE)
