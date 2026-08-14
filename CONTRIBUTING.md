# Contributing

Thanks for your interest in Treequel! This file covers setup, quality checks and commit conventions. See
[AGENTS.md](AGENTS.md) for repository structure and the conventions that apply to every change.

## Status

Pre-0.1: the repository is under initial construction and nothing is published to npm yet. Check the
[open issues](https://github.com/PhenX/Treequel/issues) for direction; for anything non-trivial, open an issue first
so we can agree on the approach before you invest time.

## Getting set up

Prerequisites: **Node.js 20+**, npm, Git.

```bash
git clone https://github.com/PhenX/Treequel.git
cd Treequel
npm ci
npm run verify
```

## Quality checks & tests

From the repo root:

| Command | What it does |
|---|---|
| `npm run verify` | Everything below in order — what CI runs |
| `node scripts/check-graph.mjs` | Dependency-graph rules |
| `npx oxlint` | Lint |
| `npx oxfmt --check .` | Formatting |
| `npx tsc -b` | Typecheck |
| `npm run build --workspaces --if-present` | Build all packages |
| `npx vitest run` | All tests — `--project unit` for the fast loop |

## Commit messages & PR titles

This repo uses [Conventional Commits](https://www.conventionalcommits.org/), enforced by a commit-msg check locally
and in CI. Versioning is lockstep — every `@treequel/*` package shares one version, chosen at release time — so the
type doesn't decide the bump; it decides where the change appears in the generated changelog.

### Format

```
type(scope): subject
```

- `type` — required: `feat` `fix` `perf` `docs` `chore` `ci` `refactor` `test` `build` `style` `revert`
- `scope` — optional but encouraged, from the closed list: `tree` `core` `capture` `fallback` `transform` `vite`
  `linq` `memory` `sql` `ts-plugin` `eslint-plugin` `docs` `playground` `examples` `tooling` `ci` `deps` `release`
- `subject` — required: lowercase start, imperative mood ("add", not "added"/"adds"), no trailing period, full header
  ≤ 100 chars

Mark a break of the tree wire format or of a package's public API with `!` after the type/scope, or a
`BREAKING CHANGE:` footer.

### Examples

```
feat(capture): reject loose equality with an autofix suggestion
fix(sql): escape LIKE wildcards in startsWith arguments
docs: clarify the boundary rule for opaque functions
ci: shard the conformance project
feat(tree)!: encode bigint constants as tagged strings

BREAKING CHANGE: serialized trees containing bigint constants require format version 2.
```

## Dependencies

Every third-party dependency needs a justified row in `DEPENDENCIES.md` in the same PR that adds it. Runtime packages
(`@treequel/tree`, `core`, `linq`, providers) accept **no** production dependencies at all.

## Releases

Lockstep, via `scripts/release.mjs` from a manually dispatched workflow (patch/minor/major): it bumps every package to
the same version, rewrites internal `"*"` ranges, updates `CHANGELOG.md` from the commit history, tags, and publishes
each public package to npm with provenance.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md) once it lands; until then, use GitHub's
private vulnerability reporting on this repository rather than a public issue.
