## 2026-08-18 — Package README pass (whole-repo survey)

### Finding: Emitted error anchors use greffon.dev while docs deploy on phenx.github.io
- **File/Component**: `packages/tree/src/error.ts` (`docsUrl`), `packages/capture/src/diagnostics.ts` (`docsAnchor`), `packages/tree/src/schema.ts` (`$id`)
- **Issue**: Anchors emit `https://greffon.dev/errors#Rxxxx`; the docs site deploys at `https://phenx.github.io/Greffon/`. AGENTS.md codifies the greffon.dev form, so this is intentional only if the custom domain gets wired before 0.1.
- **Impact**: Every emitted error link is dead until the domain exists. Anchors are append-only/load-bearing, so this must be settled before first release.
- **Suggested fix**: Wire the `greffon.dev` domain (or decide the canonical host once and update `docsUrl` + schema `$id` + AGENTS.md together, pre-release only).

### Finding: GLOBALS_SAFELIST defined twice
- **File/Component**: `packages/core/src/wellknown.ts` and `packages/capture/src/capture.ts`
- **Issue**: Identical 13-name safelists, both public; core and capture cannot import each other, so the copies can drift silently.
- **Impact**: A drift would let capture accept a global the evaluator cannot resolve (or vice versa).
- **Suggested fix**: A shared-fixture test asserting both arrays are equal (cheapest), or move the list to `@greffon/tree`.

### Finding: R3001 has two meanings
- **File/Component**: `packages/capture/src/diagnostics.ts` vs `packages/core/src/expr.ts`
- **Issue**: Catalog defines R3001 as warn "Runtime fallback active (no build plugin ran)"; expr.ts throws R3001 as a hard error when no tree is available and no fallback is registered.
- **Impact**: One code, two opposite conditions; docs anchor can only describe one.

### Finding: R1107 catalog summary narrower than its uses
- **File/Component**: `packages/capture/src/diagnostics.ts`
- **Issue**: Summary says "Only arrow functions are allowed as nested lambdas" but the code also raises R1107 for non-arrow functions at the top level.

### Finding: Build errors omit the docs anchor and line:col
- **File/Component**: `packages/vite/src/index.ts` (~line 100), `packages/ts-transformer` `reportDiagnostics`
- **Issue**: AGENTS.md says error-docs anchors are emitted in build errors, but both hosts format `code message — hint (file)` with no docs URL and no line:col, though diagnostics carry spans.
- **Impact**: Weaker parity with editor/lint output; harder to jump from a CI log to the error page.

### Finding: "Lazy-loaded" claim for meriyah is about invocation, not loading
- **File/Component**: `packages/fallback/package.json` description, `DEPENDENCIES.md`
- **Issue**: meriyah is statically imported by both entries; only the parse is deferred.

### Finding: Host option asymmetry for diagnostics level
- **File/Component**: `packages/vite` (`"error" | "warn"`) vs `packages/ts-transformer` (adds `"silent"`)

### Finding: eslint-plugin comment says "ESLint 9+" while peers allow >=8
- **File/Component**: `packages/eslint-plugin/src/index.ts` flat-config preset comment vs `package.json` peerDependencies.

### Finding: ts-plugin is not dogfooded in this repo
- **File/Component**: no `tsconfig*.json` lists `@greffon/ts-plugin` under `compilerOptions.plugins`, unlike the eslint-plugin consumed via `.oxlintrc.json`.
### Finding: query engine plumbing sits at src/ top level, not src/internal/
- **File/Component**: `packages/query/src/{canon,navpredicates}.ts` (and neighbors)
- **Issue**: AGENTS.md's layout rule puts non-public plumbing under `src/internal/**`; these modules are at the top of `src/`. Some engine internals are deliberately re-exported for provider authors, so this is a judgment call, but the two named files read as private.
- **Suggested fix**: Move genuinely-private modules under `src/internal/`, or note the intentional exception in the query area guide.
