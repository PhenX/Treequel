# Treequel — Expression Trees & LINQ for TypeScript

> *Trees in, queries out. The sequel is trees.*

**Design & Implementation Plan**
Status: Draft for implementation · Version: 1.0 · Target runtime: ESM, Node ≥ 20, modern browsers

> Name: **Treequel** — tree + sequel, where "sequel" is both how SQL is pronounced and what this is to LINQ. Bare package name `treequel` verified free on the npm registry; npm scope `@treequel/*` — verify org availability at publish time, fallback prefix `treequel-*`. Known prior use: a Ruby LDAP gem of the same name (2008, unmaintained for ~7+ years, different ecosystem and domain; its name was also a tree+Sequel pun, which independently validates the joke). Expect its docs in search results for the first months; mitigate with "treequel typescript" SEO framing. Runners-up, verified free: `treeson`, `syntree`, `extree`, `stumped`, `symmetree`, `marquetry`, and `quosure` (R/rlang's quoted-expression+closure term — kept in docs prose as the name of the `Expr` concept, where it's genuinely the precise word).

---

## Table of contents

1. [Vision, goals, non-goals](#1-vision-goals-non-goals)
2. [System architecture](#2-system-architecture)
3. [Monorepo layout](#3-monorepo-layout)
4. [Package specifications](#4-package-specifications)
5. [The expression tree format (`@treequel/tree`)](#5-the-expression-tree-format)
6. [Capture: subset grammar, free variables, emitted code](#6-capture)
7. [The build transform (`@treequel/transform` + `@treequel/vite`)](#7-the-build-transform)
8. [Runtime core (`@treequel/core`)](#8-runtime-core)
9. [The query layer (`@treequel/linq`)](#9-the-query-layer)
10. [Providers](#10-providers)
11. [Type system design](#11-type-system-design)
12. [Editor & lint surface](#12-editor--lint-surface)
13. [Diagnostics catalog](#13-diagnostics-catalog)
14. [Testing strategy](#14-testing-strategy)
15. [Repository tooling & CI/CD](#15-repository-tooling--cicd)
16. [Milestones](#16-milestones)
17. [Key decisions (ADR summaries)](#17-key-decisions-adr-summaries)
18. [Risks & open questions](#18-risks--open-questions)

---

## 1. Vision, goals, non-goals

### 1.1 One-paragraph pitch

Write ordinary TypeScript lambdas — `u => u.age > minAge && u.name.startsWith(prefix)` — and have them exist simultaneously as (a) an executable function and (b) a serializable, typed expression tree that providers translate to SQL, OData, IndexedDB queries, remote calls, or anything else. The same lambda filters an in-memory array in your unit test and compiles to a parameterized SQL `WHERE` clause in production. This is C#'s `Expression<Func<T,bool>>` + `IQueryable<T>`, rebuilt for the TypeScript ecosystem with a build-time transform (a native Vite plugin, Rollup/Rolldown-compatible by construction) as the reification mechanism.

### 1.2 Goals (v1)

- **G1 — Native feel.** Query call sites are plain TS lambdas with full inference; no wrapper required at traced call sites. Marker function `expr()` exists only as an escape hatch.
- **G2 — Closure capture.** Free variables in lambdas are captured live (thunk), exactly like C# closures. `u => u.age > minAge` just works.
- **G3 — Robustness.** Behavior is identical under minification, transpilation targets, and bundler pipelines. (This is what rules out `Function.prototype.toString()` as the primary mechanism.)
- **G4 — Retargetable trees.** The tree format is a small, closed, versioned, JSON-serializable algebra. Providers are pure tree translators.
- **G5 — Dual execution.** Every `Expr` carries the compiled original; the in-memory provider is the reference semantics for all other providers.
- **G6 — Graceful degradation.** Without the plugin: in-memory paths work fully; remote providers fall back to runtime parse with precise, teachable errors on closures.
- **G7 — Vite-native, portable by construction.** The plugin uses only Rollup-compatible hooks (`enforce: "pre"` + `transform` + `load`), so it runs unchanged in Vite, Rollup, and Rolldown. The transform itself is a pure function in its own package (`@treequel/transform`), so webpack/Rspack adapters (e.g. a community unplugin wrapper) are possible post-0.1 without touching core.
- **G8 — First-class DX.** Language-service plugin (red squiggles in-editor for out-of-subset syntax), ESLint rule, code-framed build errors, pretty tree printing.

### 1.3 Non-goals (v1)

- **N1 —** Full ORM (migrations, schema management, relations mapping). We define query semantics; schema/connection concerns live in providers and can integrate with existing tools (e.g., a Kysely- or pg-backed provider).
- **N2 —** Statement-bodied lambdas, loops, assignments, classes inside expressions. The subset is expression-only + a tiny statement whitelist later (§6.2).
- **N3 —** Reifying arbitrary functions passed by reference across module boundaries without `expr()`. Explicit boundary rule (§7.4).
- **N4 —** Type-checker-driven reification (C#'s exact mechanism). Rejected for dev-server performance; see ADR-2.
- **N5 —** Non-ESM output. ESM-only, `"type": "module"`, no CJS builds.

### 1.4 Beyond the ORM (positioning)

Querying a database is the *proof of concept*, not the product. The product is a portable, typed, serializable representation of intent — "code as data" for TypeScript — and the provider protocol is the delivery mechanism. Domains the v1 architecture must not preclude (each is "just a provider" or "just a tree consumer" by construction):

- **Remote predicates.** Serialize a tree over HTTP; a server (Node — or anything, via the JSON Schema) rehydrates and applies it through its own provider. Client-defined filtering without a query-language API surface.
- **Authorization & policy.** One policy expression (`doc => doc.ownerId === user.id || doc.visibility === "public"`) evaluated three ways: as a SQL `WHERE` for list endpoints, in-memory for single-object checks, and translated for the UI ("why is this button disabled"). Policy-as-expression is arguably a bigger market than queries.
- **Shared validation.** The same rule tree runs in the browser form and the API handler; the tree, not a schema DSL, is the shared artifact.
- **Rules engines / feature flags.** Business rules stored as serialized trees, editable, diffable, auditable, and executable anywhere — with `print()` giving human-readable renderings for review UIs.
- **Client-side stores.** IndexedDB, SQLite-WASM, in-memory caches — local-first apps querying local data with the same expressions they send to the server.
- **Query pushdown to services.** OData/GraphQL/REST-filter compilation targets for APIs you don't own.

Design consequences already in place: trees are JSON-plain and versioned (§5), providers are pure translators over a closed grammar (§10), the tree package has zero dependencies forever, and the JSON Schema makes non-TS consumers first-class. The docs and README must lead with this framing — "expression trees for TypeScript, with LINQ as the flagship application" — not "a new way to talk to Postgres."

### 1.5 Success criteria

- A sample app queries Postgres through `db.users.where(u => ...).select(u => ...)` with zero wrappers, and the identical query file runs under Vitest with no plugin configured, against fixture arrays, producing equal results (property-tested).
- `npm create vite` + add one plugin line + `npm i` two packages → working in under 5 minutes.
- Tree JSON round-trips: `parse(print(tree))` and `deserialize(serialize(tree))` are identity; structuredClone-safe.

---

## 2. System architecture

### 2.1 Component diagram

```
                          ┌────────────────────────────────────────────┐
   your source            │  BUILD TIME                                │
   ────────────           │                                            │
   db.users               │  @treequel/vite (thin plugin)              │
     .where(u =>          │   └─ @treequel/transform (pure function)    │
                          │       ├─ import tracer (traced roots)      │
        u.age > minAge)   │       ├─ call-chain detector (expr pos.)   │
     .select(...)   ────▶ │       └─ @treequel/capture                  │
                          │           ├─ subset validator ─▶ diagnostics│
                          │           ├─ free-variable analysis        │
                          │           └─ tree serializer               │
                          │              │ magic-string + sourcemaps   │
                          └──────────────┼─────────────────────────────┘
                                         ▼ emitted __expr({...})
                          ┌────────────────────────────────────────────┐
                          │  RUN TIME                                  │
                          │                                            │
                          │  @treequel/core                            │
                          │   ├─ Expr<F> (brand, compiled, tree, scope)│
                          │   ├─ visitor / rewriter                    │
                          │   ├─ partial evaluator (fold captures)     │
                          │   └─ printer / inspect                     │
                          │                                            │
                          │  @treequel/linq                            │
                          │   ├─ Queryable<T> (lazy, immutable)        │
                          │   ├─ QueryPlan (source + ops[])            │
                          │   └─ QueryProvider interface               │
                          │        ├─ @treequel/provider-memory (reference)
                          │        ├─ @treequel/sql-core (pg first)│
                          │        └─ third-party providers            │
                          │                                            │
                          │  @treequel/fallback (dev-only path)        │
                          │   └─ fn.toString() → meriyah → capture     │
                          └────────────────────────────────────────────┘

   editor/CI surface: @treequel/ts-plugin (language service),
                      @treequel/eslint-plugin — both reuse @treequel/capture
```

### 2.2 The one shared brain: `@treequel/capture`

The subset validator, free-variable analysis, and tree serializer are implemented **once**, operating on a normalized ESTree-with-TS AST, and consumed by four hosts: the build transform, the runtime fallback, the language-service plugin, and the lint rule. This is the most important structural decision in the repo — it guarantees the editor, the build, and the fallback never disagree about what's legal.

To make one implementation serve hosts with different parsers, `capture` defines a minimal **`AstAdapter`** interface (node kind mapping, child traversal, source spans) with two adapters:

- `adapter-oxc` — for the build transform (oxc-parser: fast native parser with ESTree-compatible output and TS support).
- `adapter-tsc` — for the language-service plugin and ESLint's `@typescript-eslint` trees (both are `ts.Node`/TSESTree; one adapter with a thin TSESTree shim).
- The runtime fallback parses with **meriyah** (small, fast, pure-JS) → ESTree → reuses `adapter-oxc`'s ESTree mapping.

### 2.3 Data flow of a single query

1. **Author** writes `db.users.where(u => u.age > minAge)`.
2. **Build**: tracer sees `db` derives from `createContext()` imported from `@treequel/linq`; the arrow in argument position of a traced chain is an expression position; validator OKs it; serializer emits `__expr({ compiled, params, body, scope, meta })` in place, preserving the original lambda as `compiled`.
3. **Runtime**: `where()` receives an `Expr`, appends `{ op: "where", expr }` to an immutable `QueryPlan`.
4. **Execution point** (`await`/`toArray()`): plan handed to the provider. Provider runs **partial evaluation** — every subtree composed only of `Capture`/`Constant` nodes is evaluated against `scope()` and folded to `Constant` — then translates the residual tree (SQL provider → parameterized SQL; memory provider → just calls `compiled`).
5. **Results** typed as `T[]` (or `R[]` after `select`), end to end via the phantom brand.

---

## 3. Monorepo layout

npm workspaces (native). ESM-only. TypeScript project references for editor speed and topological typechecking via `tsc -b`; **tsdown** for build output — it is the library bundler of the same rolldown/oxc stack Vite itself is built on, so it adds no second compiler vendor to the repo.

```
treequel/
├─ .github/
│  ├─ workflows/
│  │  ├─ ci.yml                  # lint + typecheck + test + build, matrix Node 20/22, OS ubuntu+windows
│  │  ├─ release.yml             # tag-triggered: lockstep bump script → npm publish --provenance
│  │  └─ pkg-health.yml          # publint on packed tarballs
│  ├─ ISSUE_TEMPLATE/            # bug.yml, feature.yml, provider-request.yml (GH issue forms)
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ dependabot.yml             # GitHub-native dep updates, weekly, grouped
├─ packages/
│  ├─ tree/                      # @treequel/tree      — node types, (de)serialization, schema, ZERO deps
│  ├─ core/                      # @treequel/core      — Expr, visitor, partial eval, printer
│  ├─ capture/                   # @treequel/capture   — validator + free-var analysis + serializer + AstAdapter
│  ├─ fallback/                  # @treequel/fallback  — runtime toString→meriyah path
│  ├─ transform/                 # @treequel/transform — pure transformModule(code,id,opts) → {code,map,diagnostics}
│  ├─ vite/                      # @treequel/vite      — thin Vite plugin over transform (Rollup/Rolldown-compatible)
│  ├─ linq/                      # @treequel/linq      — Queryable, QueryPlan, provider protocol, createContext
│  ├─ provider-memory/           # @treequel/provider-memory
│  ├─ sql-core/              # @treequel/sql-core (dialect: postgres first; mysql/sqlite later)
│  ├─ ts-plugin/                 # @treequel/ts-plugin — language service plugin
│  └─ eslint-plugin/             # @treequel/eslint-plugin
├─ apps/
│  ├─ docs/                      # VitePress site (guide, provider-author guide, tree spec)
│  └─ playground/                # Vite app: live transform output + tree inspector (dogfoods everything)
├─ examples/
│  ├─ vite-postgres/             # the headline demo: same queries in vitest (memory) + pg
│  └─ no-plugin-fallback/        # demonstrates degradation story
├─ tooling/
│  ├─ tsconfig/                  # base.json, lib.json, app.json (shared tsconfigs, workspace pkg)
│  └─ vitest/                    # shared vitest presets (unit, transform-snapshot, type-tests)
├─ scripts/
│  ├─ release.mjs                # lockstep version bump + tag + publish (plain Node, no deps)
│  └─ check-graph.mjs            # enforces §3.1 dependency edges (~30 lines, replaces dependency-cruiser)
├─ .oxlintrc.json                # oxlint config (root)
├─ .oxfmtrc.json                 # oxfmt config (root; or oxfmt defaults + no file)
├─ vitest.workspace.ts
├─ tsconfig.json                 # solution file: references all packages
├─ package.json                  # "workspaces": ["packages/*","apps/*","examples/*","tooling/*"]
├─ CONTRIBUTING.md  ·  CODE_OF_CONDUCT.md  ·  SECURITY.md  ·  LICENSE (MIT)
└─ README.md
```

### 3.1 Dependency graph (must stay acyclic; enforced in CI)

```
tree ◀── core ◀── linq ◀── provider-memory
  ▲        ▲        ▲  ◀── sql-core
  │        │        │
  └── capture ◀── transform ◀── vite
         ▲     ◀── fallback (also depends on core)
         ├──── ts-plugin
         └──── eslint-plugin
```

Rules: `tree` has zero runtime deps forever (it defines the wire format). `core` depends only on `tree`. Nothing in runtime packages may import parser libraries — parsers live only in `capture` adapters, `fallback` (meriyah), and `transform` (oxc-parser). Enforced by `scripts/check-graph.mjs` in CI — a ~30-line script reading each package.json against an allowlist; no dependency-analysis framework needed.

### 3.2 Package conventions (every package)

```jsonc
// package.json essentials
{
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": { "build": "tsdown", "dev": "tsdown --watch", "test": "vitest run" }
}
```

- `src/index.ts` is the only public entry per package.
- Internal modules under `src/internal/` are not exported; publint verifies no deep-import leakage.
- Each package has `README.md` (rendered on npm); a single root `CHANGELOG.md` (lockstep versioning, §15).

---

## 4. Package specifications

Summary table; detailed specs in §5–§12.

| Package | Purpose | Runtime deps | Size budget (min+gz) |
|---|---|---|---|
| `@treequel/tree` | Node types, serialize/deserialize, format version, JSON schema | none | < 2 kB |
| `@treequel/core` | `Expr<F>`, visitor/rewriter, partial eval, printer, inspect | `tree` | < 5 kB |
| `@treequel/capture` | Subset validator, free-var analysis, serializer, `AstAdapter` | `tree` | n/a (build/edit-time) |
| `@treequel/fallback` | Runtime `toString()` capture | `core`, `capture`, `meriyah` | < 25 kB, **lazy-loaded** |
| `@treequel/transform` | Pure per-module transform (tracer, detector, splicing) | `capture`, `oxc-parser`, `magic-string` | n/a (dev-time) |
| `@treequel/vite` | Thin Vite plugin over `transform` (Rollup-compatible hooks) | `transform` | n/a (dev dep) |
| `@treequel/linq` | `Queryable`, `QueryPlan`, provider protocol, `createContext` | `core` | < 4 kB |
| `@treequel/provider-memory` | Reference provider | `linq` | < 2 kB |
| `@treequel/sql-core` | Tree → parameterized SQL (pg dialect first) | `linq` | < 10 kB |
| `@treequel/ts-plugin` | LS diagnostics in-editor | `capture` | n/a |
| `@treequel/eslint-plugin` | Same rules for lint-gated CI | `capture` | n/a |

---

## 5. The expression tree format

`@treequel/tree` is the contract of the whole system: a **small, closed, versioned** discriminated union. Design principles: JSON-plain (structuredClone/postMessage/HTTP-safe), no functions, no prototypes, no cycles; every node optionally carries `span` (source offsets) which is **stripped on serialize by default**.

### 5.1 Node kinds (v1 — the complete list)

```ts
// FORMAT_VERSION = 1  — bump on any breaking change; deserializer refuses newer majors.
export type Node =
  | Param        // { kind:"Param", name:string }                    lambda parameter reference
  | Capture      // { kind:"Capture", name:string }                  free variable (resolved from scope())
  | Constant     // { kind:"Constant", value: Json, type?: ConstTag }// literals + partial-eval results
  | Member       // { kind:"Member", object:Node, prop:string, optional?:true }
  | Index        // { kind:"Index", object:Node, index:Node, optional?:true }   a[b]
  | Call         // { kind:"Call", callee:Node, args:Node[], optional?:true }   incl. method calls: callee=Member
  | Binary       // { kind:"Binary", op:BinaryOp, left:Node, right:Node }
  | Logical      // { kind:"Logical", op:"&&"|"||"|"??", left:Node, right:Node }
  | Unary        // { kind:"Unary", op:"!"|"-"|"+"|"typeof", operand:Node }
  | Ternary      // { kind:"Ternary", test:Node, then:Node, else:Node }
  | Template     // { kind:"Template", quasis:string[], exprs:Node[] }
  | ObjectLit    // { kind:"ObjectLit", props: ({key:string, value:Node} | {spread:Node})[] }
  | ArrayLit     // { kind:"ArrayLit", elements:(Node|{spread:Node})[] }
  | Lambda       // { kind:"Lambda", params:string[], body:Node }    nested lambdas (e.g. .some(x => ...))
  | In           // { kind:"In", needle:Node, haystack:Node }        never emitted by capture; produced by the provider normalize pass from `arr.includes(x)` (§10.2)

export type BinaryOp = "==="|"!=="|"<"|"<="|">"|">="|"+"|"-"|"*"|"/"|"%"|"**"|"instanceof"|"in";
export type ConstTag = "date"|"bigint"|"regexp"|"undefined"; // JSON-unsafe values, tagged encoding
```

Notes and hard rules:

- **`==`/`!=` are rejected at capture time** (diagnostic R1103) — loose equality has no sane cross-provider semantics. Autofix to `===`/`!==` in the ESLint rule.
- `Constant` values that aren't JSON-native are encoded as `{ $tag:"date", iso:"..." }` etc. via `ConstTag`; `serialize()`/`deserialize()` own this. `NaN`/`Infinity` encode as tagged too.
- `Lambda` covers nested arrows appearing as call arguments (`u.tags.some(t => t.startsWith("a"))`). Nested lambdas share the same subset rules recursively; their params shadow outer names (free-var analysis §6.3).
- There is deliberately **no** `Assignment`, `Sequence`, `New`, `Await`, `Yield`, `TaggedTemplate`, `Class`, `This` in v1. `this` inside expression lambdas is diagnostic R1104.
- `Index` is separate from `Member` (computed vs static access) because providers treat them very differently (JSON path vs column).

### 5.2 Serialization

```ts
serialize(node: Node, opts?: { keepSpans?: boolean }): TreeJson   // { v: 1, root: ... }
deserialize(json: unknown): Node                                   // validates shape, throws R1901 on bad/newer format
```

Ship a generated JSON Schema (`tree.schema.json`) built from the TS types via a build step — it documents the wire format for non-TS consumers (e.g., a Go/.NET server rehydrating remote queries) and is used in fuzz tests.

### 5.3 Method-call semantics: recognized surface

The tree stores calls **structurally** (`Call(Member(Param u, "name"), "startsWith", [...])`); it does not bake in a function whitelist — that's a *provider capability*, not a format concern. However, `core` publishes a **`WellKnown` registry** naming the calls all first-party providers commit to, so providers share one vocabulary and one test suite:

| Category | Members (v1) |
|---|---|
| String | `startsWith`, `endsWith`, `includes`, `toLowerCase`, `toUpperCase`, `trim`, `length` (as Member), `slice`, `indexOf` |
| Number/Math | `Math.abs/floor/ceil/round`, arithmetic ops |
| Date | `getFullYear/getMonth/getDate`, comparisons on Date constants (post partial-eval most date math is already folded) |
| Array (on columns) | `includes` (→ SQL `IN`/`ANY`), `length`, `some`/`every` w/ Lambda (→ `EXISTS` where relational) |
| Nullish | `??`, optional chaining (`optional:true` flags) |

Unknown calls are **legal in the tree**, and each provider decides: translate, execute-locally-if-fully-folded (a `Call` whose args are all `Constant` after partial eval is itself foldable via safe-list, §8.3), or reject with R2001 naming the provider and the call.

---

## 6. Capture

Shared by build transform, fallback, LS plugin, ESLint rule. Input: an arrow-function AST node + its enclosing scope info (via the `AstAdapter`). Output: `{ params, body: Node, freeVars: string[], diagnostics: Diagnostic[] }`.

### 6.1 Pipeline

```
arrow AST ─▶ 1 normalize (adapter → internal shape, strip TS type nodes: `as`, satisfies, <T> args, !)
          ─▶ 2 validate subset (walk; collect diagnostics with spans; bail if any error)
          ─▶ 3 bind scopes (params, nested-lambda params, destructured bindings)
          ─▶ 4 free-variable set = referenced idents − bound − globals-safelist
          ─▶ 5 serialize to tree (Param vs Capture decided by step 4)
```

TS-specific note (step 1): type-only syntax is *stripped, not rejected* — `u => (u.meta as Meta).flag` captures as `Member(Member(u,"meta"),"flag")`. Non-null `!` likewise strips. `satisfies` strips. Enum member access is an ordinary `Member` chain on a `Capture` and folds under partial eval.

### 6.2 The subset grammar (v1)

**Allowed:** expression-bodied arrows only. Expression forms: everything with a Node kind in §5.1, plus parenthesization. Parameters: plain identifiers or **object-destructuring with identifier shorthand** (`({id, name}) => ...` binds `id`,`name` as Params with recorded paths — encoded as `Member(Param<synthetic>, "id")` so providers see uniform trees; the synthetic root param is named `$0`).

**Rejected (diagnostic, with span + suggestion):** block bodies `{...}` (R1101 — "use a single expression; extract statements above the query"), assignments & update ops (R1102), `==`/`!=` (R1103), `this` (R1104), `new` (R1105), `await`/`yield` (R1106), function declarations/expressions non-arrow (R1107), tagged templates (R1108), regex *literals* inside the body (R1109 — allowed as captured constants: hoist to a `const` above), comma/sequence (R1110), array-destructured or rest params (R1111, v1), default param values (R1112, v1), getters via computed `Member` with non-constant index where the provider requires static columns → provider-time R2002, not capture-time.

The grammar is versioned alongside the tree format. Planned v2 extensions (design now, implement later): a whitelisted statement body — `const` declarations + single `return` — desugared into nested `Ternary`/let-binding nodes (`Let` node kind reserved).

### 6.3 Free-variable analysis (the correctness-critical 200 lines)

Algorithm: single AST walk with a scope stack.

1. Push scope with the lambda's own bindings (params; destructured names; nested `Lambda` params push/pop around their bodies).
2. For every `Identifier` in **reference position** (not: member `prop` names, object-literal keys, param declarations), resolve against the stack; unresolved → candidate free var.
3. Subtract the **globals safelist**: `Math`, `Number`, `String`, `Boolean`, `Date`, `JSON`, `Array`, `Object`, `Infinity`, `NaN`, `undefined`, `Intl`, `BigInt`. (Configurable via plugin option `globals: [...]`.) These serialize as `Capture` with `global:true`? **No** — simpler: they serialize as plain `Member`/`Call` chains rooted at `Constant{ value:{$tag:"global", name:"Math"} }`… **Decision (ADR-7): root global usage as `Capture{name:"Math", global:true}` and have `scope()` NOT include globals; partial eval resolves `global:true` captures from a fixed realm table.** Keeps `scope()` minimal and SSR-safe.
4. Remaining names are true captures. Emitted `scope` thunk closes over exactly this set: `() => ({ minAge, prefix })`. Shadowing test cases: nested lambda param shadowing an outer capture; capture shadowing a module import; TDZ (`let` declared after the query in module scope — legal, thunk defers evaluation to execution time; document this as matching C# closure semantics).
5. **Module-level imports** referenced inside lambdas are captures like any other (the thunk closes over the imported binding). This is how helper functions travel: `u => slugify(u.name)` → `Call(Capture("slugify"), [...])`; memory provider executes it; SQL provider rejects (R2001) unless args fold and the safe-list permits local execution.

Edge cases that must have dedicated tests: same-name param and capture in sibling lambdas of one chain; `typeof x` where `x` is a capture (legal) vs undeclared (still a capture — runtime decides); labeled shorthand `{name}` object literal (shorthand value is a reference → may be Capture or Param).

### 6.4 Emitted code shape (build) — normative

```ts
import { __expr } from "@treequel/core";  // injected once per module, aliased to avoid collision: __tql_expr$

__tql_expr$({
  v: 1,
  compiled: (u) => u.age > minAge && u.name.startsWith(prefix),  // ORIGINAL text, untouched
  params: ["u"],
  body: /* Node JSON, inlined as a plain object literal */,
  scope: () => ({ minAge, prefix }),
  src: "u => u.age > minAge && u.name.startsWith(prefix)",       // dev only; stripped when minify build detected? keep behind option `emitSource` (default: dev true, prod false)
  loc: "src/queries/users.ts:12:18",                              // dev only
})
```

Idempotence rule: the transform must recognize `__tql_expr$({ v: 1, ...` (call to an identifier imported from `@treequel/core` named `__expr`) and skip it. This makes double-transformation (plugin listed twice, pre-transformed library code shipped to npm) safe. `__expr` at runtime: validates `v`, freezes the object, brands it, returns it — O(1), no parsing.

---

## 7. The build transform

Two packages with a hard boundary:

- **`@treequel/transform`** — a pure function `transformModule(code, id, options, host) → { code, map, diagnostics } | null`, plus the context-manifest registry. No bundler imports; `host` is a tiny interface (`loadModule(id)`, `resolve(id, importer)`) so any bundler can drive it. All logic in §7.2–§7.5 lives here and is tested bundler-free via snapshots.
- **`@treequel/vite`** — ~100 lines: a Vite plugin with `enforce: "pre"` wiring `transform()` and `this.load()` into the host interface. Because it uses only Rollup-compatible hooks, the same export works in Rollup and Rolldown; document that. (webpack/Rspack via a community unplugin wrapper post-0.1 — deliberately not a v1 dependency.)

### 7.1 Plugin options

```ts
interface TreequelPluginOptions {
  include?: FilterPattern;        // default: /\.[cm]?[jt]sx?$/
  exclude?: FilterPattern;        // default: node_modules (except packages listing "reify" keyword? no — v2)
  packages?: string[];            // traced import sources; default: ["@treequel/linq"] + auto: providers re-exporting createContext
  diagnostics?: "error" | "warn"; // default "error" in build, "warn" in dev serve
  emitSource?: boolean | "dev";   // default "dev"
  globals?: string[];             // extend globals safelist
}
```

### 7.2 Per-module fast path

1. `if (!filter(id)) return null;`
2. Cheap pre-scan: module must contain one of the traced package names **or** `expr(` → else `return null` (zero parse cost for 99% of modules).
3. Parse with `oxc-parser` (TS/TSX aware), `enforce: "pre"` so we see original TS before esbuild strips types.
4. Run tracer + detector (§7.3); for each hit run `capture`; splice replacements with `magic-string`; return `{ code, map }` (hires sourcemap).

Performance budget: < 1 ms per non-matching module (pre-scan only), < 10 ms per matching module of ordinary size. Measure in CI (`bench/` with tinybench, tracked via a simple regression threshold, not a dashboard, for v1).

### 7.3 Import tracing & expression-position detection

**Roots.** Collect local bindings for: (a) any import from a traced package (`createContext`, `expr`, `from`, and namespace imports `* as r`); (b) re-exports of those through project files are *not* followed cross-module in v1 (see boundary rule) — instead, the common pattern is blessed: any call result of a traced `createContext()` in the *same module graph* is typically exported as `db` from a `db.ts`, and importing modules see `db` as… untraceable without cross-module info. **Resolution (ADR-5): type-free cross-module tracing via a "context manifest":** `createContext()` call sites are transformed to also register their exported binding; the plugin maintains a build-scoped registry (`Map<moduleId, exportName[]>`) populated in a first pass over `packages` + user modules matching `include`. Vite's dev server does modules on demand, so the registry is filled lazily: when module A imports `{ db } from "./db"`, the transform of A queries the registry; if `./db` isn't transformed yet, transform it on demand via `this.load()` (Rollup/Vite context API) — Vite, Rollup, and Rolldown all support requesting another module's transform via the plugin context. Fallback for hosts without `load()` (future non-Rollup adapters): a documented `/* @treequel-context */` comment on the import line, or the `expr()` wrapper.
**Chains.** Within a module, a traced value taints: direct call results (`db.users`), member access, `const q = db.users.where(...)` intermediates, ternaries where both arms are tainted. Standard intra-module taint over the binding graph — no type checker.
**Expression positions.** Arrow literals appearing as **direct arguments** to member-calls on tainted values whose method name is in the LINQ surface (`where/select/orderBy/orderByDescending/thenBy/take/skip/groupBy/count/any/all/first/single/sum/min/max/distinct/join`) are reified. Arrows passed as *variables* are NOT (boundary rule §7.4). `expr(...)` calls are always reified regardless of taint.

### 7.4 The boundary rule (normative, documented, tested)

> Only lambda **literals** written directly at a traced call site, or wrapped in `expr()`, become expression trees. A plain function value reaching a provider that needs a tree fails at plan-build time with R2003: `Opaque function passed to .where() — write the lambda inline or wrap it with expr().`

The in-memory provider accepts opaque functions (it just calls them) but logs a dev-mode warning R2004 so tests don't silently diverge from what production providers can do. (Silently accepting them in the reference while SQL rejects them would undermine G5.)

### 7.5 Sourcemaps, HMR, SSR

- magic-string `generateMap({ hires: true })`; composed automatically by Vite.
- Transform is stateless per module except the context manifest → HMR-safe; manifest entries invalidated on module update hooks.
- SSR: same transform applies to `ssr` transforms in Vite (`applyToEnvironment`/`transform` in both envs). Emitted code is environment-neutral (no window/globalThis assumptions).

---

## 8. Runtime core

### 8.1 `Expr<F>` (public shape)

```ts
declare const brand: unique symbol;
export interface Expr<F extends (...a: never[]) => unknown> {
  readonly [brand]?: F;            // phantom; optional so structural fakes can't crash inspect
  readonly params: readonly string[];
  readonly body: Node;
  readonly scope: () => Record<string, unknown>;
  readonly compiled: F;
  readonly src?: string; readonly loc?: string;
}
export function isExpr(x: unknown): x is Expr<any>;
export function expr<F extends (...a: any[]) => any>(f: F): Expr<F>;   // identity+fallback host (§8.4)
```

`toString()` returns `src ?? print(body)`; `[Symbol.for("nodejs.util.inspect.custom")]` pretty-prints the tree.

### 8.2 Visitor / rewriter

```ts
export function visit(n: Node, v: Partial<Record<Node["kind"], (n) => void>>): void;
export function rewrite(n: Node, v: Partial<Record<Node["kind"], (n) => Node | undefined>>): Node; // structural sharing on no-change
export function children(n: Node): Node[];   // uniform traversal used by both
```

Everything downstream (partial eval, printers, SQL translation, capability checks) is built on these three functions.

### 8.3 Partial evaluation (the LINQ `Evaluator.PartialEval` port)

Two passes:
1. **Mark**: bottom-up; a node is *evaluable* iff it and all children contain no `Param` and it's structurally executable locally: `Capture`, `Constant`, `Member`/`Index` on evaluable, `Binary`/`Logical`/`Unary`/`Ternary`/`Template`/`ObjectLit`/`ArrayLit` of evaluable, and `Call` whose callee resolves to the **fold safe-list** (`WellKnown` pure functions + any `Capture`d user function — user functions ARE folded when arg-closed, because that matches `compiled` semantics; this is safe precisely because both paths execute the same code).
2. **Fold**: top-down replace maximal evaluable subtrees with `Constant` (tagging Dates/BigInts). Evaluation happens against `scope()` *at execution time* → live closures, C#-style.

Exposed as `partialEval(expr): Node`; providers call it first, always. Property test: for a corpus of trees, `evaluate(partialEval(t)) === compiled(...)` on random inputs.

### 8.4 The runtime fallback (`@treequel/fallback`)

When `expr(f)` executes with a plain function (no plugin ran):
1. Warn once per process (R3001) with a link to setup docs.
2. `f.toString()` → meriyah parse (lazy `import()` so the parser never enters transformed bundles) → shared `capture` pipeline.
3. Free variables found → throw R3002 naming them: `'minAge' is captured from the enclosing scope; the runtime fallback cannot read closures. Enable the build plugin, or inline the value.` — unless the provider is memory (which never needed the tree).
4. Minified/native source detected (heuristics: `[native code]`, single-letter params + mangled bodies can't be *detected* reliably — so instead: fallback is **refused in production builds** via `process.env.NODE_ENV === "production"` check → R3003).

---

## 9. The query layer

### 9.1 Public API

```ts
// context creation — the traced root; relations feed include() (ADR-0004)
export function createContext<Schema>(provider: QueryProvider, options?: { relations?: SchemaRelations<Schema> }): Context<Schema>;
type Context<S> = { readonly [K in keyof S]: Queryable<S[K]> };

// db.ts (user code)
const relations = defineRelations<{ users: User; orders: Order }>({
  users:  { orders: { kind: "many", target: "orders", from: "id", to: "userId" } },
  orders: { user:   { kind: "one",  target: "users",  from: "userId", to: "id" } },
});
export const db = createContext<{ users: User; orders: Order }>(pgProvider(pool, schemaMeta), { relations });

// Queryable<T> — lazy, immutable; every method returns a NEW Queryable
interface Queryable<T> {
  where(p: Pred<T>): Queryable<T>;
  select<R>(s: Proj<T, R>): Queryable<R>;
  orderBy<K>(k: Key<T, K>): Ordered<T>;          // Ordered adds thenBy/thenByDescending
  orderByDescending<K>(k: Key<T, K>): Ordered<T>;
  distinct(): Queryable<T>;
  take(n: number): Queryable<T>; skip(n: number): Queryable<T>;
  groupBy<K>(k: Key<T, K>): Queryable<Grouping<K, T>>;
  join<U, K, R>(inner: Queryable<U>, outerKey: Key<T,K>, innerKey: Key<U,K>, result: Result2<T,U,R>): Queryable<R>;
  leftJoin<U, K, R>(inner: Queryable<U>, outerKey: Key<T,K>, innerKey: Key<U,K>, result: Result2<T,U|null,R>): Queryable<R>;
  // include/thenInclude (ADR-0004): nav selectors are probed (single property
  // access over `compiled`), never captured; Loaded<> marks the nav required.
  include<R>(nav: NavSelector<T, R>): Includable<Loaded<T, KeysWithValue<T,R>>, NavElement<R>>;
  // executors (async — providers may be remote); names follow JS (Array
  // some/every, Prisma-style nullable first) rather than LINQ (ADR-0005)
  toArray(): Promise<T[]>;
  first(p?: Pred<T>): Promise<T | null>; firstOrThrow(p?: Pred<T>): Promise<T>;
  single(p?: Pred<T>): Promise<T>;
  count(p?: Pred<T>): Promise<number>;
  some(p?: Pred<T>): Promise<boolean>; every(p: Pred<T>): Promise<boolean>;
  sum(s: Key<T, number>): Promise<number>; min/max/avg(...): Promise<...>;
  inMemory(): Queryable<T>;                       // explicit client-eval boundary (§10.4, ADR-11):
                                                  // provider executes the prefix; the rest of the chain
                                                  // runs on the memory provider via `compiled`
  [Symbol.asyncIterator](): AsyncIterator<T>;    // streaming when provider supports it
  toSql?(): never;                                // NOT on Queryable — provider-specific escape hatch lives on provider
  explain(): Promise<string>;                     // provider-rendered plan (SQL text, "memory scan", etc.)
}
interface Includable<T, TNav> extends Queryable<T> {
  thenInclude<R>(nav: NavSelector<TNav, R>): Includable<T, NavElement<R>>;
}
type Pred<T>  = ((t: T) => boolean) | Expr<(t: T) => boolean>;
type Proj<T,R>= ((t: T) => R)      | Expr<(t: T) => R>;
type Key<T,K> = ((t: T) => K)      | Expr<(t: T) => K>;
```

Decision (ADR-6): **no thenable `Queryable`** (`await q` without `.toArray()`); implicit-execution thenables interact badly with conditional plan building and `Promise.all` of intermediates. Explicit executors only; terse enough via `first/count/toArray`.

### 9.2 QueryPlan (what providers receive)

```ts
interface QueryPlan {
  readonly source: string;                        // "users"
  readonly ops: readonly PlanOp[];                // ordered
}
type PlanOp =
  | { op:"where";  expr: Expr<any> }
  | { op:"select"; expr: Expr<any> }
  | { op:"orderBy"|"thenBy"; expr: Expr<any>; desc: boolean }
  | { op:"take"|"skip"; n: number }
  | { op:"distinct" } | { op:"groupBy"; expr: Expr<any> }
  | { op:"join"|"leftJoin"; inner: QueryPlan; outerKey: Expr<any>; innerKey: Expr<any>; result: Expr<any> }
  | { op:"include"; spec: IncludeSpec }          // self-contained: nav, target, from/to keys, kind, children (ADR-0004)
  | { op:"exec"; kind:"toArray"|"first"|"single"|"count"|"some"|"every"|"sum"|"min"|"max"|"avg"; expr?: Expr<any>; orNull?: boolean };

interface QueryProvider {
  readonly name: string;
  capabilities(): Capabilities;                   // declarative: which ops/WellKnown calls it translates
  execute<T>(plan: QueryPlan, signal?: AbortSignal): Promise<T>;
  explain?(plan: QueryPlan): Promise<string>;
}
```

`Queryable` performs a **capability pre-check** at execution: walk the plan, compare against `capabilities()`, and fail fast with R2001/R2002 including the offending source `loc` — before any I/O. This turns "SQL can't translate `.map()` here" into an immediate, located error instead of a driver exception.

---

## 10. Providers

### 10.1 `provider-memory` (the reference)

~150 lines: for each op, apply the JS-native equivalent using `expr.compiled` (never the tree). `groupBy` → Map; `join` → hash join; executors trivially. This provider defines semantics; every other provider's conformance suite (§14.3) asserts equality against it.

### 10.2 `sql-core` (Postgres first)

Pipeline per plan: `partialEval` every expr → **normalize** (rewrite pass: `x.includes(y)`→`In`, `!(a && b)`→De Morgan optional, null-comparison normalization `x === null` → `IS NULL`) → **translate** with a dialect table → emit `{ text, values }` parameterized SQL (never string-interpolated values; `Constant`s become `$n` params).

Core translation table (pg dialect):

| Tree | SQL |
|---|---|
| `Binary ===` / `!==` | `=` / `<>` (with `IS [NOT] NULL` normalization) |
| `Logical && / \|\| / ??` | `AND` / `OR` / `COALESCE(a, b)` |
| `Member(Param, p)` | `"table"."p"` via schema meta (identifier-quoted; column map overridable) |
| deep `Member` past columns | JSONB path `col->'a'->>'b'` when schema meta marks column as json; else R2002 |
| `Call startsWith/endsWith/includes` (string) | `LIKE $n \|\| '%'` / `LIKE '%' \|\| $n` / `LIKE '%' \|\| $n \|\| '%'` with `ESCAPE` and input escaping of `%_\` |
| `Call toLowerCase/toUpperCase` | `LOWER/UPPER` |
| `Member length` (string) | `LENGTH(col)` |
| `In` (array constant) | `= ANY($n)` |
| `Ternary` | `CASE WHEN t THEN a ELSE b END` |
| `Template` | `\|\|` concatenation with `COALESCE` per null policy |
| `select` ObjectLit | projection list with aliases; nested objects → `jsonb_build_object` (flag-gated) |
| ops `where/orderBy/take/skip/distinct/join/leftJoin` | `WHERE` (ANDed), `ORDER BY`, `LIMIT/OFFSET`, `DISTINCT`, `INNER/LEFT JOIN ON` — compiled as a layer stack: an op that would change meaning under SQL clause order wraps the current SELECT into a derived table (ADR-0004); `groupBy` stays memory-only in v1 |
| `include` | split queries: per navigation one batched fetch (`= ANY($n)` pg / chunked `IN` sqlite via `dialect.maxBatchKeys`), stitched by the shared helpers in `linq`; attaches to final rows only |
| `nav.some(p)` / `nav.every(p)` in predicates | correlated `EXISTS (SELECT 1 …)` / `NOT EXISTS (… NOT p)` against the navigation's target (relations ride on the plan; the nested lambda translates in a lexical child scope) |
| `nav.length`, `nav.filter(p).length`, `nav.reduce((acc,o)=>acc+e,0)` | correlated scalar subqueries: `COUNT(*)`, filtered `COUNT(*)`, `COALESCE(SUM(e),0)` — usable in projections, predicates, orderBy keys and aggregate selectors (ADR-0006) |
| `groupBy(k)` + `select(g => …)` | `GROUP BY` with aggregate projections over `g.key`/`g.items` (`length`→COUNT, filtered counts, reduce sum/min/max idioms, `sum/count` for averages); non-column keys precompute into a derived table; `where` after the projection wraps = HAVING; raw groups stay memory-only (ADR-0007) |
| `include(nav, q => q.where/orderBy/take/skip)` | refined split fetch: filters/order fold into the batched child query; per-parent slices via `ROW_NUMBER() OVER (PARTITION BY key …)` gated by `dialect.windowFunctions` (ADR-0008) |
| `flatMap(nav)` / `flatMap(nav, result)` | expand through a navigation (EF `SelectMany`): `INNER JOIN` onto the target; without a selector the layer swaps to the child shape so chained flatMap/include/nav-predicates resolve against the flattened source (ADR-0009) |
| executors | `count`→`COUNT(*)`, `some`→`EXISTS(...)`, `first`→`LIMIT 1` (+`single` → `LIMIT 2` + runtime cardinality check) |

Schema meta is minimal and explicit in v1: `{ users: { table:"users", columns:{ id:"id", createdAt:"created_at" }, json?: ["meta"] } }`. No introspection in v1 (providers may add it).

Driver-agnostic: the provider takes an `executor: (text, values) => Promise<{rows}>` so it works over `pg`, `postgres.js`, Neon, PGlite (PGlite powers the conformance suite in CI — real Postgres semantics, no service container… fall back to a `services: postgres` container if PGlite WASM proves flaky on Windows runners).

### 10.3 Provider-author kit

Exported from `linq/testing`: the conformance suite as a function `runConformance(makeProvider, { fixtures })` (§14.3), the normalize pass, a `TranslateContext` helper (param counter, identifier quoting, error factory with `loc`), and the shared translatability checker below. Docs: "Write a provider" guide is a first-class docs chapter — third-party providers are the ecosystem bet.

### 10.4 Translatability detection & the client-eval boundary

Detection is layered; each layer shrinks the problem for the next.

1. **Closed grammar (build time).** Providers can only ever receive the §5.1 node kinds — translatability is a total function over a finite node set, never an open-world search. The only open dimension is `Call` targets.
2. **Partial evaluation (execution time, first).** After folding (§8.3), residual trees contain only Param-rooted data access, constants, and operations over them. Guarantee: no `Capture` node survives folding except in callee position of a `Call` whose arguments are Param-dependent (→ R2005). Most "untranslatable" source constructs (helper calls with closed args, date math, config reads) are already constants here.
3. **Capability pre-check (before any I/O).** `Queryable` walks the folded plan against `capabilities()`: plan ops vs `dialect.ops`; Param-rooted `Member`/`Index` chains must resolve through schema meta to a column or declared JSON path (else R2002); every `Call` must resolve to a key in `dialect.calls` (else R2001, naming provider + call + `loc`); nested `Lambda` (`some`/`every`) requires the corresponding relational capability. Any diagnostic → throw before touching the database.
4. **Call resolution via tree typing.** The dialect table is keyed `(receiverType, method)` (e.g. `string.startsWith`). Receiver types come from a bottom-up type inference over the tree — trivial because the grammar is closed: column types from schema meta, `Constant` tags, and fixed operator result types propagate upward. Untypeable receivers (usually undeclared JSON paths) make a call *ambiguous* → R2006 ("declare the column type in schema meta"), never a guess. Shortcut: method names unique across `WellKnown` resolve without receiver typing.

Detection ≠ semantics: "can emit SQL" is not "means the same as the JS". The reference property suite (§14.2) owns semantic equivalence; every divergence it finds (LIKE escaping, null ordering, collation) becomes a conformance regression fixture.

**No silent client evaluation (ADR-11).** Untranslatable residue is a fail-fast error, never a quiet fallback — except through the explicit boundary operator:

```ts
db.users
  .where(u => u.age > 18)            // → SQL
  .inMemory()                        // visible, auditable line — rows cross here
  .where(u => scoreModel(u) > 0.7)   // → memory provider, runs `compiled`, any JS allowed
```

`inMemory()` splits the plan: the provider executes the prefix; the suffix runs on `provider-memory` over the materialized rows. Opaque functions and unknown calls are legal after the boundary (R2003/R2001 no longer apply there). The capability pre-check runs on the prefix only.

---

## 11. Type system design

- **Union acceptance** `F | Expr<F>`: contextual typing of lambda parameters through a union of a function type and an object type with an optional phantom function property is the risky spot. Mitigations, in order: (1) single non-overloaded signatures; (2) phantom key optional and `in`-variance-neutral (`[brand]?: F`); (3) a `type-tests/` suite (vitest + expect-type) asserting: param inference in `where`, return inference in `select` incl. object-literal widening, `strictNullChecks` behavior for the nullable `first`, no excess-property leakage of brand in errors. If inference degrades in some TS version, plan B is `Pred<T> = (t: T) => boolean` in the *public* signature with the transform+`expr()` both producing values that still structurally match via the optional-brand trick — decided by the type tests, which run against TS `latest` and `next` nightly in CI.
- **Error ergonomics:** never require users to write `Expr<...>`; docs always show plain lambdas. `Grouping<K,T>` mirrors C#: `{ key: K } & Iterable<T>` with provider-defined materialization.
- **`strict` everywhere**; public API passes `--isolatedDeclarations` (keeps .d.ts generation trivial and fast under tsdown).

---

## 12. Editor & lint surface

### 12.1 `@treequel/ts-plugin` (language service)

- Hooks `getSemanticDiagnostics`; finds traced call sites with the *same* detector logic compiled against the `adapter-tsc`; runs the validator; maps capture diagnostics to `ts.Diagnostic` (category from severity, code = numeric part of Rxxxx, source: "treequel").
- Also enhances `getQuickInfoAtPosition` on `expr`-produced values to show the printed tree (small delight, cheap).
- Ships with a `configurePlugin` handshake so the Vite plugin can print a hint if the LS plugin isn't configured (`tsconfig.json → compilerOptions.plugins: [{ "name": "@treequel/ts-plugin" }]`).

### 12.2 `@treequel/eslint-plugin`

- Rule `treequel/valid-expression`: same validator over TSESTree via the shared adapter; autofix for R1103 (`==`→`===`).
- Rule `treequel/no-opaque-callback`: flags function *references* passed to traced LINQ methods (the boundary rule, at lint time instead of runtime).
- Preset `plugin:treequel/recommended`.

Definition of done for this section: the same invalid lambda produces the same code + message in editor squiggle, eslint output, and build error (golden-file test asserts all three).

---

## 13. Diagnostics catalog

Single source of truth `packages/capture/src/diagnostics.ts`; every diagnostic has code, severity, message template, docs anchor (`https://treequel.dev/errors#R1101`), and a fixture in the test corpus.

| Range | Domain | Examples |
|---|---|---|
| R1100–R1199 | Capture/subset | R1101 block body · R1102 assignment · R1103 loose equality · R1104 `this` · R1105 `new` · R1106 await/yield · R1109 regex literal · R1111 rest/array-destructure param |
| R1900–R1999 | Tree format | R1901 bad/newer serialized format |
| R2000–R2099 | Provider/plan | R2001 untranslatable call (names provider + call + loc) · R2002 dynamic index / unresolvable column path · R2003 opaque function at provider · R2004 opaque function in reference (warn) · R2005 Param-dependent call to captured function · R2006 ambiguous call — declare column type in schema meta |
| R3000–R3099 | Fallback | R3001 fallback active (warn once) · R3002 closure in fallback (names variables) · R3003 fallback refused in production |
| R4000–R4099 | Plugin/config | R4001 context import untraceable (suggests `expr()` or `@treequel-context`) · R4002 double-transform detected (info) |

---

## 14. Testing strategy

### 14.1 Layers

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | visitor laws, partial-eval folding, free-var edge cases, serializer round-trips |
| Transform snapshots | Vitest + inline fixtures | for each `fixtures/*.input.ts`: emitted code snapshot + parsed-tree snapshot + sourcemap position spot-checks. Golden files reviewed in PRs |
| Diagnostics golden | Vitest | every Rxxxx has ≥1 fixture; message + span asserted; parity across build/LS/eslint hosts |
| Type tests | Vitest `expectTypeOf` (+ `tsc --noEmit` matrix TS latest & next) | §11 inference guarantees |
| Property tests | fast-check | (a) tree gen → `evaluate(partialEval(t))` ≡ direct eval; (b) predicate gen + data gen → **memory ≡ SQL** row sets (the reference test, run on PGlite); (c) serialize/deserialize identity |
| Conformance | `runConformance` | shared behavioral suite each provider must pass vs memory reference: nulls, Unicode/collation notes, empty sources, LIKE-escaping (`%`,`_` in user input!), date boundaries, `single` cardinality |
| E2E | Vitest + Vite programmatic build (`vite.build()` in-process) of `examples/vite-postgres` | plugin wiring, HMR smoke via Vite dev-server API, fallback example errors as documented |
| Bench | tinybench in `bench/` | transform per-module cost; regression threshold in CI (fail > 30% slower than committed baseline) |

### 14.2 The reference test is the crown jewel

`fast-check` arbitraries generate: a schema (3–6 columns of mixed types incl. nullable), row sets (with nulls, empty strings, `%_` characters, Unicode, boundary dates), and predicate/projection trees restricted to the WellKnown surface. Assert `sortCanonical(await memory) deepEquals sortCanonical(await sql)` (unordered ops compare as multisets). Every provider bug becomes a shrunk minimal counterexample. Run 200 cases per PR, 5 000 nightly.

### 14.3 Test topology

Shared presets in `tooling/vitest`; `vitest.workspace.ts` defines projects `unit`, `types`, `transform`, `conformance`, `e2e` so `npx vitest --project unit` is fast locally and CI can shard.

---

## 15. Repository tooling & CI/CD

Philosophy, stated as policy: **native-first, minimal dependencies.** npm-native workflows, GitHub-native services (Actions, Pages, Dependabot, provenance via OIDC), and one compiler vendor — the VoidZero/Vite stack (oxc, rolldown, oxlint, oxfmt, tsdown, Vitest) — for everything code-shaped. Every third-party dev dependency must appear in the inventory (§15.4) with a justification; anything replaceable by ≤50 lines of plain Node script is replaced.

### 15.1 Toolchain

| Concern | Choice | Notes |
|---|---|---|
| Package manager | **npm workspaces** (npm ≥ 10, pinned via `packageManager` + corepack) | `"workspaces"` in root package.json. Internal deps declared as `"*"` — always link-resolved locally; lockstep versioning (below) keeps published ranges coherent. Shared tool versions live once in root `devDependencies`; a 20-line check in `check-graph.mjs` forbids workspace-level duplicates. |
| Task running | **npm scripts + `tsc -b`** — no task runner | Typecheck: project references give native topological ordering and incremental caching. Builds: internal deps are *externalized* by tsdown (they're runtime deps, never bundled), so per-package JS builds are order-independent → plain `npm run build --workspaces --if-present`. Apps/examples that need built libs run after via explicit root scripts. Cold full build target < 15 s; at that scale Turborepo's two benefits (remote cache, orchestration) buy nothing — revisit only if the repo outgrows this, and record it as a new ADR. |
| Compiler/bundler (libs) | **tsdown** | Rolldown/oxc-based — same stack as Vite; d.ts via `isolatedDeclarations`; treeshake-friendly ESM. |
| TypeScript | 5.x, `strict`, `verbatimModuleSyntax`, `isolatedDeclarations` on public packages; project-references solution `tsconfig.json` | |
| Lint | **oxlint** (root `.oxlintrc.json`) | categories: correctness + suspicious + perf; adopt type-aware rules as they stabilize. The `eslint-plugin` package still ships for *consumers* (its ESLint deps are peer/dev-local to that package and its tests — they never touch the rest of the repo). |
| Format | **oxfmt** | `oxfmt --check` in CI; no formatter config debates. |
| Tests | **Vitest 3** workspace | coverage via v8 provider; thresholds on `tree`/`core`/`capture` at 95%. |
| Versioning/release | **Lockstep** — all `@treequel/*` share one version (the oxc/vite-ecosystem model) | `scripts/release.mjs` (plain Node, zero deps): bump all package.json versions, rewrite internal `"*"` ranges to the concrete version at publish time, update root `CHANGELOG.md` from git log (Conventional Commits enforced by a 15-line commit-msg check), tag `vX.Y.Z`, `npm publish --provenance` per public package. Changesets deliberately omitted; adopt later only if per-package versioning becomes a real contributor need (ADR-9). |
| Publishing | **npm with `--provenance`** via GitHub OIDC (`id-token: write`) | tarballs pass publint before publish. |
| Dep updates | **Dependabot** (GitHub-native) | weekly, grouped; separate always-open canary PR pinning oxc/TS `next` handled by a scheduled workflow instead of Renovate. |
| Docs | **VitePress** in `apps/docs` → GitHub Pages via Actions | includes generated tree JSON-schema page and diagnostics reference generated from `diagnostics.ts` (single source of truth). |
| Community | GH issue forms (bug/feature/provider-request), PR template, `CODEOWNERS`, MIT, `SECURITY.md` with private vulnerability reporting | all GitHub-native. |

### 15.2 `ci.yml` (sketch)

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  verify:
    strategy: { matrix: { os: [ubuntu-latest, windows-latest], node: [20, 22] } }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: node scripts/check-graph.mjs          # §3.1 edges + no duplicated tool deps
      - run: npx oxlint && npx oxfmt --check .
      - run: npx tsc -b                             # topological, incremental
      - run: npm run build --workspaces --if-present
      - run: npx vitest run                         # workspace projects; conformance uses PGlite
  types-next:                                       # TS nightly — allowed to fail, visible
    continue-on-error: true
    steps: [checkout, setup-node, npm ci, install typescript@next, npm run test:types]
  pkg-health:
    steps: [checkout, setup, npm ci, "npm pack each public pkg → publint tarball → install tarballs into a scratch project and import-smoke them"]
  bench:
    if: github.event_name == 'pull_request'
    steps: [tinybench run, compare vs baseline JSON committed in repo, PR comment]
```

`release.yml`: manual `workflow_dispatch` (choose patch/minor/major) → runs full verify → `node scripts/release.mjs` → publish with provenance → GitHub Release from the changelog section → deploy docs. The pack-and-install smoke test in `pkg-health` replaces a local registry (no Verdaccio dependency).

### 15.3 Repo hygiene on day one

- `packageManager` + `engines` pinning; `.npmrc` with `save-exact=true` for devDependencies.
- `scripts/check-graph.mjs` enforcing §3.1 (allowed-edges map, duplicate-tool check, `private:true` on apps/examples).
- `examples/*` are private but **built and executed in CI** — they are integration tests in disguise.
- Playground app deployed with docs — the "paste code → see emitted `__tql_expr$` + tree + SQL" page is the single best marketing artifact this project can have.

### 15.4 Complete third-party dependency inventory

This table is normative: adding a dependency means adding a row and a justification in the PR.

| Where | Dependency | Why it can't reasonably be vendored/omitted |
|---|---|---|
| **Runtime packages** (`tree`, `core`, `linq`, `provider-*`) | **none** | Zero production dependencies is a headline feature; CI fails if any appear. |
| `@treequel/transform` (user dev-time) | `oxc-parser` | TS-aware native-speed parsing; the one parser the whole VoidZero stack shares. |
| | `magic-string` | Sourcemap-correct splicing; tiny; maintained by the Vite team's orbit and used by Vite itself. |
| `@treequel/fallback` (dev-only path, lazy `import()`) | `meriyah` | Pure-JS ESTree parser for browser-safe runtime parsing; oxc-parser is a native binding and can't ship to browsers. |
| Repo devDependencies | `typescript`, `vitest`, `tsdown`, `oxlint`, `oxfmt` | the toolchain |
| | `vitepress` | docs (isolated in `apps/docs`) |
| | `fast-check` | the reference property tests (§14.2) are the correctness strategy; not vendorable |
| | `@electric-sql/pglite` | real-Postgres conformance in CI without service containers |
| | `publint`, `tinybench` | tiny, CI-only |
| `@treequel/eslint-plugin` only | `eslint`, `@typescript-eslint/utils` (peer/dev) | required to *be* an ESLint plugin; scoped to that package |

Dropped relative to a conventional 2026 setup, with the reasoning on record: pnpm (npm workspaces suffice at lockstep), Turborepo (§15.1), Biome/ESLint-for-the-repo (oxlint+oxfmt), unplugin (Rollup-compatible Vite plugin covers Vite/Rollup/Rolldown; wrapper later), changesets (lockstep script), Renovate (Dependabot), dependency-cruiser/syncpack (`check-graph.mjs`), arethetypeswrong (ESM-only + publint + the pack-and-install smoke covers the failure modes it would catch), Verdaccio (pack-and-install smoke).

---

## 16. Milestones

Each milestone ends green-in-CI and demo-able. Estimates assume one focused engineer.

**M0 — Repo bootstrap (2 days).** npm-workspace scaffold, toolchain (§15) wired, `check-graph.mjs` + `release.mjs` written, pack-and-install smoke in CI, matrix green. *Exit: `npm ci && npm run verify` green on both OSes; `release.mjs --dry-run` produces a correct publish plan.*

**M1 — Tree + core (1 wk).** `tree` node types + serializer + schema-gen; `core` visitor/rewriter/printer; partial evaluator with fold safe-list. *Exit: property tests (a) and (c) pass; 95% coverage on both packages.*

**M2 — Capture (1.5 wk).** `AstAdapter` + oxc adapter; validator with full R11xx catalog; free-var analysis incl. §6.3 edge-case corpus; serializer. *Exit: diagnostics golden suite passes; 40+ fixture corpus.*

**M3 — Transform (1.5 wk).** `@treequel/transform` pure function + host interface, pre-scan, `expr()` reification, emitted-shape + idempotence, sourcemaps; `@treequel/vite` wrapper; then import tracing + taint + context manifest (ADR-5). *Exit: transform snapshot suite (bundler-free); e2e Vite build of a toy app; same plugin object smoke-tested under Rollup; double-transform test.*

**M4 — LINQ + memory provider (1 wk).** `Queryable`/plan/protocol/capability pre-check; memory provider; type-test suite (§11) — **checkpoint: if `F | Expr<F>` inference fails here, exercise plan B before proceeding.** *Exit: examples/no-plugin path fully works; type tests green on TS latest+next.*

**M5 — SQL provider (2 wk).** Translatability checker + tree typing (§10.4), normalize pass, pg dialect table, LIKE escaping, params, executors, `.inMemory()` plan splitting, PGlite conformance + reference property test. *Exit: 5 000-case nightly reference run clean; `explain()` returns SQL text.*

**M6 — Fallback + DX surface (1.5 wk).** `fallback` package with R3xxx behavior; `ts-plugin`; `eslint-plugin`; parity golden test. *Exit: same bad lambda → same message in 3 hosts; fallback example matches docs.*

**M7 — Docs, playground, 0.1 release (1 wk).** VitePress guide (quick start < 5 min, provider-author guide, error reference), playground, headline example polished, `release.mjs` publishes `0.1.0` lockstep with provenance. *Exit: success criteria §1.5 all demonstrably true.*

Post-0.1 backlog (ordered): the HTTP/remote provider + policy-expression recipe (§1.5 is the differentiator — promote aggressively once SQL is solid) · mysql/sqlite dialects · `Let`/statement-whitelist grammar v2 · relation navigation + `include` design · unplugin wrapper for webpack/Rspack (community-friendly, isolated) · IndexedDB provider spike.

---

## 17. Key decisions (ADR summaries)

Maintain full ADRs in `docs/adr/NNNN-*.md`; summaries:

- **ADR-1: Build-time reification, runtime fallback secondary.** Runtime `toString()` cannot see closures and breaks under minification; proxies cannot capture operators. Consequence: we own a compiler-adjacent tool and its DX burden (accepted; mitigated by the Rollup-compatible plugin + fallback).
- **ADR-2: Syntactic tracing, no type checker in the hot path.** `ts.Program` in dev transform costs 100ms+ per change and breaks HMR feel. Consequence: cross-module tracing needs the context-manifest mechanism (ADR-5) instead of types.
- **ADR-3: Small closed tree, not ESTree.** Providers need a finite grammar to promise translation over; ESTree is neither closed nor stable for this purpose. Consequence: a normalization layer in capture, and a format-version discipline.
- **ADR-4: ESM-only, Node ≥ 20.** Dual builds double the test surface for a 2026-new library with a bundler-first audience.
- **ADR-9: Native-first, minimal-dependency toolchain.** npm workspaces + npm scripts + `tsc -b`; VoidZero stack (oxc-parser/oxlint/oxfmt/tsdown/Vitest) as the single compiler vendor; GitHub-native services; lockstep versioning via a zero-dep release script; every dev dependency justified in a normative inventory (§15.4). Consequences: no per-package versions, no build cache beyond tsc/Vitest — accepted at this repo's scale, revisited by ADR if it grows.
- **ADR-11: No silent client-side evaluation.** EF pre-Core silently pulled rows and evaluated untranslatable fragments in memory; it caused accidental table scans severe enough that EF Core 3.0 removed it as a breaking change. Treequel fails fast (R2001/R2002/R2005/R2006, with `loc`) and offers the explicit `.inMemory()` boundary instead — same expressiveness, but the performance cliff is a visible line in the code.
- **ADR-10: Vite-native plugin instead of unplugin.** Rollup-compatible hooks give Vite/Rollup/Rolldown from one export with zero framework dependency; the pure `transform` package keeps the door open for other bundlers without core changes.
- **ADR-5: Context manifest for cross-module tracing** (registry filled via on-demand `this.load()` through the transform host interface), `expr()`/comment fallback for hosts without it. Consequence: non-Rollup-family adapters are best-effort for traceless call sites.
- **ADR-6: No thenable Queryable; explicit executors.**
- **ADR-7: Globals as `Capture{global:true}` resolved from a fixed realm table**, keeping `scope()` minimal and serialization environment-free.
- **ADR-8: Loose equality banned in the subset** — cross-provider semantics of `==` are unspecifiable; cheaper to reject than to define.

## 18. Risks & open questions

| Risk | Likelihood | Mitigation |
|---|---|---|
| `F \| Expr<F>` contextual inference regresses in some TS release | Medium | type-test matrix incl. TS `next` nightly; plan B signature (§11) validated at M4 checkpoint |
| Cross-module tracing edge cases (barrel files, dynamic import, monorepo package boundaries) | High | boundary rule + `expr()` escape hatch keeps everything *possible*; manifest covers the 90% pattern; R4001 teaches the fix |
| oxc-parser output drift vs ESTree assumptions | Medium | adapter layer isolates it; oxc version pinned exactly; scheduled canary workflow against `next` |
| oxlint/oxfmt still maturing (rule gaps, formatter churn) | Medium | both are dev-only and swappable in a day; pin exact versions; no repo code depends on them |
| SQL semantic mismatches (collation, null ordering, LIKE escaping) | Certain, individually small | reference property test finds them; conformance suite grows a regression fixture per bug |
| PGlite instability on Windows CI | Low | fall back to Linux-only conformance + service-container Postgres job |
| Scope creep toward ORM | High (socially) | N1 non-goal enforced in issue triage; relations/`include` deferred to a designed post-0.1 RFC |

**Open questions to resolve during M2–M4** (tracked as GitHub issues from day one): exact `WellKnown` v1 list freeze; whether `select` object nesting is flag-gated or default in SQL provider; `groupBy` materialization shape for the memory reference vs SQL aggregate-only reality (likely: v1 `groupBy` must be followed by an aggregate executor or aggregate `select`, matching what SQL can honor — decide with a spike); how `join` result projections handle name collisions.

---

*End of design plan. Suggested first commit: this file at `docs/DESIGN.md`, plus M0 scaffold.*
