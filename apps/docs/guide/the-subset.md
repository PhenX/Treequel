# The expression subset

A query lambda is not arbitrary JavaScript. It is an **expression-bodied arrow** over a small, closed grammar — the
set of forms that have a defined meaning across every provider. Anything outside the subset is rejected with a coded,
located diagnostic, and you get the same message in your editor, in ESLint or oxlint, and at build time.

## Allowed

- Parameters: plain identifiers, or object-destructuring with identifier shorthand (`({ id, name }) => …`).
- Member access `u.name` and index access `u.items[0]`, including optional chaining (`u.a?.b`).
- Calls, including method calls (`u.name.startsWith("A")`) and nested lambdas for `some` / `every`
  (`u.tags.some((t) => t.startsWith("a"))`).
- Binary, logical, unary, and ternary operators; template literals; object and array literals.
- Captured free variables (`minAge`) and safelisted globals (`Math`, `Date`, `JSON`, …).

TypeScript-only syntax is stripped, not rejected: `as`, `satisfies`, non-null `!`, and type arguments all disappear
before the tree is built.

## Rejected

Out-of-subset syntax produces an error with a stable code (see the [error reference](/errors)):

| Form | Code |
| --- | --- |
| Block-bodied arrow `{ … }` | [R1101](/errors#R1101) |
| Assignment / update operators | [R1102](/errors#R1102) |
| Loose equality `==` / `!=` | [R1103](/errors#R1103) |
| `this` | [R1104](/errors#R1104) |
| `new` | [R1105](/errors#R1105) |
| `await` / `yield` | [R1106](/errors#R1106) |
| Non-arrow function expressions | [R1107](/errors#R1107) |
| Tagged templates | [R1108](/errors#R1108) |
| Regex literals in the body | [R1109](/errors#R1109) |

Loose equality is rejected because `==` has no single cross-provider meaning; the ESLint rule autofixes it to `===`.
A regex literal is rejected inside the body — hoist it to a `const` above the query and capture it instead.

## Why a closed grammar

A provider promises to translate what it receives. That promise is only possible over a finite set of node kinds: with
a closed grammar, "can this be translated?" is a total function, not an open-world search. The one open dimension is
which functions a call targets, and each provider decides that explicitly — translating it, folding it when its
arguments are constant, or rejecting it with a located error that names the provider and the call.
