# Example: no-plugin-fallback (graceful degradation)

What happens **without** the build plugin (goal G6), shown in
[`src/degradation.test.ts`](src/degradation.test.ts):

1. **In-memory works fully — even with closures.** The memory provider calls the
   compiled lambda directly; it never needs the tree, so
   `db.users.filter(u => u.age >= minAge)` just works.

2. **Remote providers fall back to a runtime parse.** With
   `import "@treequel/fallback/register"` (or `enableFallback()`), a *closure-free*
   lambda is reified from `Function.prototype.toString()` and compiles to SQL.

3. **Closures fail with a teachable error.** A lambda that captures a variable
   can't be read from `toString()`, so a remote provider throws **R3002**, naming
   the variable and pointing at the build plugin — never a silent wrong result.

```
R3002: 'minAge' is captured from the enclosing scope; the runtime fallback
cannot read closures. Enable the build plugin, or inline the value.
```

Run it:

```bash
npm test -w @treequel-example/no-plugin-fallback
```
