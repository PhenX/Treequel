# ADR 0016 — The query subset is enforced syntactically, not in the type system

Status: accepted

## Context

The expression subset is validated once, in `@greffon/capture`, and surfaced through four hosts that share that one
validator: the build transform (`@greffon/vite`, `@greffon/ts-transformer`), the runtime fallback, the language-service
plugin (`@greffon/ts-plugin`), and the lint rules (`@greffon/eslint-plugin`). Two recurring questions ask whether that
surface could be tightened:

1. **Can a project be forced to enable the editor plugin and the lint rules**, so a violation cannot slip past an
   author who never turned them on — in the IDE or in CI?
2. **Could the subset be a type error instead**, so plain `tsc` rejects an out-of-subset lambda with no plugin, no
   language-service entry, and no lint config at all?

Both point at the same wish: make enforcement unavoidable without asking the consumer to opt in. This ADR records why
neither reshapes the design, and where enforcement actually lives.

## Decision

**The subset is a syntactic property, enforced by the shared AST validator, and the unskippable gate is the build — not
the linter, not the editor, and not the type system.**

### The type system cannot express the subset

TypeScript types describe values; they do not describe the shape of the code that produced a value. The subset rules
are about that shape, so types are blind to them:

- A block-bodied arrow `u => { return u.age > 1 }` (R1101) has the *same type* as `u => u.age > 1`.
- `u => u.age == 1` (R1103) types identically to the `===` form — both operands and the result are unchanged.
- `this`, `new`, `await`, and assignments inside a lambda do not alter its call signature.
- The boundary rule is the sharpest case: a function passed *by reference* is indistinguishable, by type, from the same
  function written *inline*. "Written inline versus passed as a value" is not a distinction the type system can
  represent — which is exactly why that check has to read the AST.

So a type-level encoding could catch nothing that matters and would give false assurance for everything it missed. The
validator walks a normalized AST precisely because that is the only place the needed information exists. This is the
concrete form of the standing decision to keep reification out of the type checker.

### A published package cannot force a consumer's lint or editor config

Enabling the ESLint/oxlint rules means adding the plugin to *the consumer's* lint config; enabling squiggles means
listing `@greffon/ts-plugin` in *their* `tsconfig.json`, and even then it changes only the editor, never `tsc` emit.
Nothing an npm package ships reaches into either file. The one mechanism that could — a `postinstall` script that
inspects the consumer's config — is hostile, routinely disabled, and breaks caching; it is rejected.

### Enforcement is relocated to the build, with a runtime backstop

Because the two authoring-time surfaces are opt-in by nature, the enforceable gate is the build transform, which a
consumer must run to obtain expression trees at all:

- `@greffon/vite` defaults `diagnostics` to `error` under `vite build` (a subset violation fails the build) and to
  `warn` in the dev server.
- `@greffon/ts-transformer` defaults to `warn` and takes `diagnostics: "error"` to fail a `tsc`-only build; its own
  rationale for the softer default is in ADR-0012.
- The runtime is the last line: a lambda reaching a provider that needs a tree, without one, fails at plan-build time
  with R2003, and the fallback refuses to parse in a production build (R3003). A wrong translation is never emitted
  silently.

The editor plugin and the lint rules remain the *early, fast* face of the same validator — same codes, same spans,
reported while you type and in CI — valuable, and never load-bearing on their own.

## Consequences

- The four-host architecture stands: one validator, four surfaces, no attempt at a fifth type-level encoding.
- Documentation states the layering plainly (the "Enforcement" section of the Editor & lint guide), including the
  "why not a type error" answer, so the question resolves at the docs rather than recurring.
- `@greffon/eslint-plugin` keeps shipping `configs.recommended` so a consumer's opt-in is a single line; that is the
  ceiling of what a library can do for someone else's lint setup.
- The `examples/*` projects dogfood the full consumer wiring — the build plugin in `vite.config.ts` and the rules in a
  per-project `.oxlintrc.json` — so the two halves of enforcement are visible in copyable form.
- `@greffon/ts-plugin` stays deliberately editor-only; anyone wanting `tsc`-native enforcement uses the ts-transformer,
  not the language-service plugin.
