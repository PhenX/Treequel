# Example: policy-rules (policy-as-expression)

One visibility rule, written once as an ordinary lambda
([`src/policy.ts`](src/policy.ts)):

```ts
export const canSee = (viewer: Viewer) =>
  expr((d: Doc) => d.orgId === viewer.orgId && (!d.archived || viewer.role === "admin"));
```

[`src/policy.reify.test.ts`](src/policy.reify.test.ts) runs it three ways:

1. **As the list filter.** `db.docs.filter(canSee(viewer))` compiles the rule
   into the `WHERE` clause on Postgres (PGlite) — row-level filtering at the
   database, result-equal with the in-memory reference provider.

2. **As a single-object check.** The same rule answers
   "can this viewer see this document" — through `compiled` (the original
   closure), or through `evaluate` after `partialEval` folds the viewer in,
   with no function involved at all.

3. **As a stored artifact.** The folded tree is self-contained JSON:
   `serialize` → store → `deserialize` → `evaluate` still answers, and
   `print` renders it readably for a review UI or an audit log.

Run it:

```bash
npm test -w @treequel-example/policy-rules
```

The point: authorization logic usually exists three times — in the list query,
in the object check, in the audit trail. As an expression tree it exists once.
