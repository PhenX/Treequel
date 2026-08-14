# Third-party dependency inventory

Normative. Adding any dependency anywhere means adding a row here with a justification in the same PR. Anything
replaceable by ≤ 50 lines of plain Node is replaced instead. One compiler vendor: the VoidZero stack.

## Runtime dependencies

Runtime packages (`tree`, `core`, `linq`, `provider-memory`, `provider-sql`) carry **zero** production dependencies —
`scripts/check-graph.mjs` fails CI if any appear.

| Package | Dependency | Why it can't reasonably be vendored |
|---|---|---|
| `@treequel/transform` | `oxc-parser` | TS-aware native-speed parsing; the parser the VoidZero stack shares. Dev/build-time only. |
| `@treequel/transform` | `magic-string` | Sourcemap-correct source splicing; tiny; used by Vite itself. |
| `@treequel/fallback` | `meriyah` | Pure-JS ESTree parser for browser-safe runtime `toString()` parsing; `oxc-parser` is a native binding. Lazy-loaded. |
| `@treequel/ts-plugin` | `oxc-parser` | Re-parses each query lambda with the same parser as the build, for true editor/build parity. |

## Peer dependencies

| Package | Peer | Why |
|---|---|---|
| `@treequel/ts-plugin` | `typescript` (≥ 5) | It is a TypeScript language-service plugin. |
| `@treequel/eslint-plugin` | `eslint` (≥ 8) | It is an ESLint plugin; ESLint deps stay scoped to this package. |

## Repository devDependencies

| Dependency | Why |
|---|---|
| `typescript` | The type system and `tsc -b` project-reference typecheck. |
| `tsdown` | Library bundler (rolldown/oxc stack) — ESM output + `.d.ts` via `isolatedDeclarations`. |
| `oxlint`, `oxfmt` | Lint and format (the VoidZero stack); `npm run verify` gates on both. |
| `vitest`, `@vitest/coverage-v8` | Test runner + coverage. |
| `fast-check` | Property tests: serialize round-trip, partial-eval invariants, and the SQL≡memory oracle. |
| `@electric-sql/pglite` | Real-Postgres conformance in CI without a service container. |
| `tinybench` | The `bench/` transform microbenchmark and its CI regression gate. |
| `eslint`, `@typescript-eslint/parser` | Scoped to `@treequel/eslint-plugin` tests (RuleTester). |

## Deliberately not used

pnpm (npm workspaces suffice), Turborepo (cold build is small), Biome (oxlint/oxfmt), unplugin (Rollup-compatible Vite
plugin already covers Vite/Rollup/Rolldown), changesets (lockstep `release.mjs`), Renovate (Dependabot),
dependency-cruiser (`check-graph.mjs`), Verdaccio (pack-and-install smoke test).

## Planned, not yet wired

Named in the toolchain but not yet installed: `publint` (package-health). It is invoked on demand via `npx --yes
publint` in the `pkg-health` CI job rather than pinned as a dependency; it gets a row above if it is ever added to
`package.json`.
