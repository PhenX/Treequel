# Treequel — Agent Instructions

> **Note:** Treequel is unrelated to the Ruby LDAP gem of the same name (2008, unmaintained). When searching the web,
> search for "treequel typescript" — bare "treequel" surfaces the gem's docs first.

Root guide for any AI agent (Claude Code, opencode, Copilot, Cursor, …) and for human contributors. It covers the whole
monorepo: what lives where, how to verify things, and the conventions that apply everywhere.

**The build follows a design & implementation plan at `plans/DESIGN.md`** — committed to the repository so a later
agent can pick the work up (the rest of `plans/`, e.g. roadmap and exploration notes, stays local and gitignored).
Read the section covering the area you are editing, in addition to this file:

| Editing… | Read first |
|---|---|
| `packages/tree/` — node kinds, wire format, (de)serialization | plan §5 |
| `packages/capture/` — subset validator, free-variable analysis, serializer | plan §6, §13 |
| `packages/transform/`, `packages/vite/` — build transform & plugin | plan §7 |
| `packages/core/` — `Expr`, visitor/rewriter, partial evaluation | plan §8 |
| `packages/fallback/` — runtime `toString()` path | plan §8.4 |
| `packages/linq/` — `Queryable`, `QueryPlan`, provider protocol | plan §9 |
| `packages/provider-*/` — providers | plan §10 |
| `packages/ts-plugin/`, `packages/eslint-plugin/` — editor & lint surface | plan §12 |
| `apps/docs/` — VitePress documentation site | plan §15.1 + [voice](#voice) below |
| `.github/`, `scripts/`, `tooling/` — CI, release, shared configs | plan §15 |

When a package accrues rules of its own that this file doesn't carry, add an `AGENTS.md` area guide inside that
package and list it here. Put every rule in the narrowest file that covers it — area guide first, this root file only
if it truly applies everywhere.

**Plan vs. reality.** The plan is a local working document, not a mirror of the code. Once an area is implemented, the
code, its tests and `docs/adr/` are the source of truth — the committed repository must stand on its own. A deliberate
departure from the plan gets an ADR (`docs/adr/NNNN-*.md`) recording what changed and why — never a silent divergence.

## Repo status

**M0–M7 landed, bar the 0.1 publish.** All thirteen `@treequel/*` packages are implemented, typechecked (`tsc -b`) and
tested (Vitest, including fast-check property tests — serialize round-trip, partial-eval invariants, and a generative
SQL≡memory reference on PGlite — and `tsc`-checked `F | Expr<F>` type tests under `type-tests/`).
The toolchain (npm workspaces, tsdown, project references, oxlint + oxfmt gated in `npm run verify`), `check-graph.mjs`,
the Conventional-Commits `check-commit.mjs` (CI lints the PR range), `release.mjs` with changelog rendering, the
transform benchmark (`bench/`, advisory regression gate), the CI matrix + weekly TS/oxc canary, and the two integration
examples are in place. The **M7** surface exists too: the VitePress docs site (`apps/docs`) with generated diagnostics +
tree-schema pages, the playground (`apps/playground`), the manually dispatched **Release** workflow, and the community
health files (code of conduct, issue forms, CODEOWNERS). Pulled ahead of the plan's post-0.1 backlog, the SQL providers
split into **`@treequel/provider-postgres`** and **`@treequel/provider-sqlite`** over a shared **`@treequel/provider-sql`**
core (the `SqlDialect` seam + `makeSqlProvider`), so there are now thirteen `@treequel/*` packages (ADR-0003). **The one
remaining step is dispatching the Release workflow to publish `0.1.0`.** **Update this paragraph as milestones
complete.**

## Project overview

Write ordinary TypeScript lambdas — `u => u.age > minAge` — and have them exist simultaneously as an executable
function and as a serializable, typed expression tree that providers translate to SQL, remote filters, policy checks,
IndexedDB queries, or anything else. C#'s `Expression<Func<T,bool>>` + `IQueryable<T>`, rebuilt for TypeScript with a
build-time Vite plugin as the reification mechanism. Expression trees are the product; LINQ-style querying is the
flagship application. Not an ORM.

## Repository layout & where things go

The split is deliberate, keep it consistent:

- `packages/*` — code consumed by name (`@treequel/*`), published to npm. One public entry per package
  (`src/index.ts`); `src/internal/**` is private plumbing.
- `apps/*` — deployable surfaces, private: `docs` (VitePress → GitHub Pages), `playground` (Vite app dogfooding the
  transform).
- `examples/*` — standalone usage examples, private but **built and executed in CI** — they are integration tests in
  disguise.
- `tooling/*` — shared tsconfig and Vitest presets, private workspace packages.
- `scripts/*` — plain Node `.mjs`, zero dependencies (`release.mjs`, `check-graph.mjs`).
- `plans/*` — working docs, gitignored, except `plans/DESIGN.md` which is committed for agent handoff.
- `docs/adr/*` — committed ADRs: one numbered file per significant decision or departure from the plan.

The dependency graph is law and enforced by `scripts/check-graph.mjs` in CI: `tree` has zero runtime deps forever,
`core` depends only on `tree`, and no runtime package ever imports a parser — parsers live only in `capture` adapters,
`transform` (oxc-parser) and `fallback` (meriyah).

## Commands

M0 wires the toolchain; this is the contract for it. From the repo root:

| Command | Purpose |
|---|---|
| `npm ci` | Install (npm workspaces; no pnpm, no yarn) |
| `npm run verify` | Everything below in order — what CI runs, green before any release |
| `node scripts/check-graph.mjs` | Dependency edges, duplicate-tool check, private-flag check |
| `npx oxlint` | Lint |
| `npx oxfmt --check .` | Format check (`npx oxfmt .` to write) |
| `npx tsc -b` | Typecheck — project references, topological, incremental |
| `npm run build --workspaces --if-present` | Build all packages (tsdown) |
| `npx vitest run` | All test projects |
| `npx vitest run --project unit` | Fast local loop; other projects: `types`, `transform`, `conformance`, `e2e` |
| `npm run check-commit` | Lint `HEAD`'s commit message (Conventional Commits) |
| `npm run bench` · `bench:check` | Transform microbenchmark · regression gate (build the packages first) |

Run typecheck, lint and tests **once at the end** before the final commit — not after every edit.

## Contracts — break only deliberately, never silently

1. **The tree wire format** (`packages/tree`). JSON-plain, closed, versioned. Any change to node shapes or the
   serialized encoding is a format change: bump `FORMAT_VERSION`, update the deserializer's refusal logic and the
   JSON Schema, and add round-trip fixtures — all in the same PR.
2. **The emitted-code shape.** The `__expr({...})` literal is the contract between `transform` and `core`, including
   the idempotence-detection pattern that makes double-transformation safe. Both sides and the transform snapshots
   move together.
3. **Public APIs.** Anything exported from a package's `src/index.ts` is public; changing it is a breaking change.
   Everything under `src/internal/` may change freely. publint guards against deep-import leakage.
4. **Diagnostic codes.** `Rxxxx` codes are append-only once released: never renumber, never reuse a retired code,
   never change a code's meaning. Message wording may improve; each code keeps its docs anchor and ≥1 test fixture.
5. **Provider semantics.** The memory provider is the reference semantics for every other provider. A
   behavior change there changes the definition of correct for the whole ecosystem — the conformance suite moves in
   the same PR, and divergences found by the reference property test become committed regression fixtures.

## Conventions that apply everywhere

### Code

- **Keep it simple.** This is a deliberately AI-friendly codebase: obvious code beats clever code.
- Strict TypeScript everywhere; ESM-only, no CJS; Node built-ins imported as `import * as x from 'node:x'`.
- **American English** spelling throughout ("initialize", "serialize", "color").
- **Extract a shared helper** when the same block exceeds ~10 lines and appears more than once.
- Runtime packages carry size budgets (`tree` < 2 kB, `core` < 5 kB, `linq` < 4 kB, providers < 10 kB min+gz). Check
  the budget before growing them; build-time and dev-only packages are exempt.

### Comments

- **Never reference the plan.** No plan section numbers (`§6.3`), ADR numbers, milestone IDs (`M2`) or plan wording in
  code or comments — comments say what the code does, not where the requirement came from. Diagnostic codes (`R1103`)
  are different: they are product identifiers, not plan references, and appear freely in code, messages, tests and
  docs.
- **Never write before/after comparisons.** No "was X, now Y", "previously", "no longer", "replaced A with B".
  Comments describe the current state only. Git holds the history.
- **Never justify a change.** No rejected alternatives, no bug-report retelling, no "this is why we changed it". State
  the rule the code follows ("loose equality is rejected at capture time"), not the story behind it. The reasoning
  belongs in the commit message, the PR, and — for design departures — an ADR.
- These rules apply to **every** comment: doc/JSDoc comments, inline comments and comments inside tests.

### Commits & PR titles (MUST follow — CI lints every commit)

Format `type(scope): subject` ([Conventional Commits](https://www.conventionalcommits.org/)); the commit-msg check
under `scripts/` is the source of truth once M0 lands, and CI lints the full PR range.

- **type** — `feat` `fix` `perf` `docs` `chore` `ci` `refactor` `test` `build` `style` `revert`
- **scope** — closed list, anything else fails: `tree` `core` `capture` `fallback` `transform` `vite` `linq` `memory`
  `sql` `ts-plugin` `eslint-plugin` `docs` `playground` `examples` `tooling` `ci` `deps` `release`. Optional but
  include the best fit; never invent one (a change to the pg dialect table is `fix(sql)`, not `fix(dialect)`).
- **subject** — lower-case start, imperative mood, no trailing period, full header ≤ 100 chars.
- Versioning is lockstep (one version for all `@treequel/*`, chosen at release time), so types don't drive bumps —
  they drive the generated changelog. Pick them honestly: `feat`/`fix` are user-visible; a `!` or `BREAKING CHANGE:`
  footer marks tree-format or public-API breaks.
- Never bypass the commit-msg hook with `--no-verify`.

### Dependencies (normative)

- Runtime packages (`tree`, `core`, `linq`, `provider-*`) have **zero production dependencies**. This is a headline
  feature; CI fails if any appear.
- The complete third-party inventory is committed at `DEPENDENCIES.md` (created with the M0 scaffold). Adding any
  dependency anywhere means **adding a row with a justification there in the same PR**. Anything replaceable by ≤50
  lines of plain Node script is replaced instead.
- One compiler vendor: the VoidZero stack (oxc-parser, oxlint, oxfmt, tsdown, Vitest). Don't introduce a second
  parser, linter, formatter or bundler.
- Internal workspace deps are declared as `"*"`; devDependencies are exact-pinned (`save-exact=true`); shared tool
  versions live once in root `devDependencies`.

### Cross-platform shell commands

CI runs on ubuntu **and** windows. Any command shown to a **user** (docs, `*.md`, error-message hints) must work on
Windows too. Prefer a portable single command — `npm`/`npx`/`node`/`git` behave the same everywhere, and
`node -e "..."` replaces shell-isms. Avoid bash `\` line continuations; write one line. When no portable form exists,
show both: in VitePress use `::: code-group` with ```bash [Linux / macOS] + ```powershell [Windows (PowerShell)] tabs;
in GitHub-rendered `*.md` use two consecutive labeled fenced blocks. Repo scripts are plain Node (`node
scripts/*.mjs`), never bash.

### Documentation

- Update the affected doc **in the same commit** as the code change.
- `apps/docs/` is for people *using* Treequel. Contributor material (build steps, source layout, milestones) lives in
  `CONTRIBUTING.md` and this file — never on the docs site.
- Two docs pages are **generated — never hand-write or hand-edit them**: the diagnostics reference (from
  `packages/capture/src/diagnostics.ts`, the single source of truth) and the tree JSON-schema page (from the
  `@treequel/tree` types). Edit the source and regenerate.
- **Error-docs anchors are load-bearing.** Every diagnostic's docs anchor (`https://treequel.dev/errors#R1101`) is
  emitted in build errors, editor squiggles and lint output. Anchors are append-only, like the codes themselves.

#### One canonical positioning line (MUST follow)

Treequel is not a product being sold. Copy is informative, specific and honest — never promotional. The project
describes itself the same way everywhere:

> **Expression trees and LINQ for TypeScript.** Write an ordinary lambda; it stays the function it always was, and
> becomes a typed, serializable expression tree that providers translate to SQL, remote filters, policy checks — or
> anything else. The same query file runs against fixture arrays in your tests and compiles to parameterized SQL in
> production. Expression trees are the product; LINQ is the flagship application. Not an ORM.

Surfaces that carry it drift the moment one changes alone. Update them **in the same commit**: the `README.md`
subtitle · the docs hero + site description (`apps/docs`, once it exists) · the GitHub repo description + topics
(repository settings — check by hand). When the docs site lands (M7), add a drift test that pins the in-repo surfaces
clause by clause.

#### Voice

- **Banned:** superlatives ("powerful", "seamless", "blazing", "best-in-class"), conversion CTA blocks, vanity badges,
  and more than ~8 feature bullets on any one page.
- **Prefer the concrete over the categorical:** "compiles to one parameterized `WHERE` clause" beats "powerful query
  engine". Name a number, a behavior, or a limit.
- **State limits plainly.** Expression-only subset, the boundary rule, what a provider rejects, pre-1.0 status, "not
  an ORM" — trust is the point, not a caveat to bury. Docs lead with "expression trees for TypeScript, with LINQ as
  the flagship application", never "a new way to talk to Postgres".

### Tests

- Vitest workspace projects `unit` / `types` / `transform` / `conformance` / `e2e`; shared presets in
  `tooling/vitest`.
- **The reference is the strategy.** Every provider passes `runConformance` against the memory provider; every semantic
  divergence the property tests find becomes a committed conformance fixture, permanently.
- **Every `Rxxxx` diagnostic has ≥1 golden fixture** asserting message + span, with parity across the three hosts
  (build error, editor squiggle, lint output).
- Property tests use fast-check; a failure is reported with its seed — commit the shrunk counterexample as a fixture.
  No `Date.now()` or unseeded randomness anywhere in tests.
- Transform snapshots are golden files reviewed in PRs — never regenerate them blindly to make CI pass.

### Working with the user's requests

- **Capture global change requests:** when asked to apply a change across many files ("update all X to Y"), add the
  resulting convention as a rule to the relevant `AGENTS.md` so future edits follow it — narrowest file that covers it.
- **Log what you find:** bugs, inconsistencies and tech debt discovered while exploring go to
  `plans/exploration-findings.md` (local, gitignored, never committed) as:

  ```markdown
  ## [Date] — [Exploration type/area]

  ### Finding: [Brief title]
  - **File/Component**: location in codebase
  - **Issue**: what is wrong
  - **Impact**: severity and effect
  - **Suggested fix**: recommended action (omit if obvious)
  ```

- `plans/` also holds `plans/DESIGN.md` (the implementation plan) and `plans/roadmap.md` (working priorities) — all
  local-only. Public direction and open design questions are tracked as GitHub issues from day one.

## Troubleshooting

- **Command appears frozen?** It probably opened an interactive pager. Use `git --no-pager <cmd>` for
  `diff`/`log`/`show` and avoid anything that waits for input.
- **Never start a watch process in the foreground of a tool call.** Bare `npx vitest` (watch mode), `tsdown --watch`
  and `docs:dev` all block until timeout — use `vitest run`, and background anything long-lived.
- **Windows first.** The CI matrix includes windows-latest; path joins, shell quoting and CRLF issues fail there
  first. Keep scripts plain Node and paths through `node:path`.
- **PGlite flaky on Windows runners?** Known risk: keep conformance on Linux + a `services: postgres` container
  fallback rather than skipping conformance.
