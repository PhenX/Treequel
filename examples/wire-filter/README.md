# Example: wire-filter (a predicate over the wire)

A saved-search predicate defined on one side
([`src/filters.ts`](src/filters.ts)):

```ts
export const bigPurchases = (threshold: number) =>
  expr((e: AppEvent) => e.type === "purchase" && e.amount >= threshold);
```

[`src/wire.reify.test.ts`](src/wire.reify.test.ts) sends it across a process
boundary — as JSON, never as code — and uses it twice on the other side:

1. **Fold, serialize, cross.** `partialEval` folds the captured `threshold`
   in, `serialize` produces the versioned envelope, `JSON.stringify` is the
   whole transport.

2. **Live matching.** The receiver `deserialize`s (which validates against the
   closed grammar) and runs `evaluate` on each incoming event — no `eval`, no
   `new Function`, no function shipped.

3. **Backfill as a query.** `makeExpr` wraps the received tree as an `Expr`,
   and the same predicate filters the stored events through a provider —
   the "notify me when something matches" pair: SQL-shaped backfill plus
   per-event evaluation, from one wire payload.

A tampered payload (an unknown node kind) is refused with a coded error
instead of producing a half-built tree.

Run it:

```bash
npm test -w @greffon-example/wire-filter
```

Lint the filter lambdas the way a consumer would — [`.oxlintrc.json`](.oxlintrc.json)
turns on the shared subset rules (`greffon/valid-expression`,
`greffon/no-opaque-callback`), test files opted out:

```bash
npm run lint -w @greffon-example/wire-filter
```

The Vite plugin is the gate a build cannot skip; these lint rules run the same
subset check earlier, as editor and CI feedback.

The point: client-defined filtering usually means inventing a query-parameter
DSL and writing two implementations. A serialized tree is one definition,
validated on arrival, translated or interpreted at will.
