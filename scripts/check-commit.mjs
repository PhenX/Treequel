#!/usr/bin/env node
// Conventional Commits linter — the source of truth for commit and PR-title
// format. Plain Node, zero dependencies. Enforces `type(scope): subject` with a
// closed type + scope list, a lower-case imperative subject, and a header no
// longer than 100 characters.
//
//   node scripts/check-commit.mjs "feat(core): add rewriter"   # one message
//   node scripts/check-commit.mjs --last                        # HEAD's message
//   node scripts/check-commit.mjs --file .git/COMMIT_EDITMSG    # a message file
//   node scripts/check-commit.mjs --range origin/main..HEAD     # a commit range

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TYPES = [
  "feat",
  "fix",
  "perf",
  "docs",
  "chore",
  "ci",
  "refactor",
  "test",
  "build",
  "style",
  "revert",
];

// Closed scope list — anything else fails. Kept in sync with AGENTS.md.
export const SCOPES = [
  "tree",
  "core",
  "capture",
  "fallback",
  "transform",
  "vite",
  "linq",
  "memory",
  "sql",
  "ts-plugin",
  "eslint-plugin",
  "docs",
  "playground",
  "examples",
  "tooling",
  "ci",
  "deps",
  "release",
];

const MAX_HEADER = 100;
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.+)$/;

/**
 * Validate a single commit message (or PR title). Returns the list of rule
 * violations; an empty list means the header is valid.
 */
export function lintMessage(message) {
  const header = String(message).split("\n", 1)[0].trimEnd();
  const errors = [];

  if (header.length === 0) return ["empty commit message"];
  if (header.length > MAX_HEADER) {
    errors.push(`header is ${header.length} chars; keep it ≤ ${MAX_HEADER}`);
  }

  const m = HEADER.exec(header);
  if (!m || !m.groups) {
    errors.push(`header must match 'type(scope): subject' (got '${header}')`);
    return errors;
  }

  const { type, scope, bang, subject } = m.groups;
  if (!TYPES.includes(type)) {
    errors.push(`type '${type}' is not one of: ${TYPES.join(", ")}`);
  }
  if (scope !== undefined && !SCOPES.includes(scope)) {
    errors.push(`scope '${scope}' is not in the closed list: ${SCOPES.join(", ")}`);
  }
  if (/^[A-Z]/.test(subject)) {
    errors.push("subject must start lower-case");
  }
  if (subject.endsWith(".")) {
    errors.push("subject must not end with a period");
  }
  // `!` marks a breaking change; nothing else to check on the header for it.
  void bang;

  return errors;
}

// --- CLI ---------------------------------------------------------------------

/** Read `subject\0body` for every non-merge commit in a range, via NUL records. */
function commitsInRange(range) {
  const out = execFileSync("git", ["log", "--no-merges", "--format=%B%x00", range], {
    encoding: "utf8",
  });
  return out
    .split("\0")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function run(argv) {
  const messages = [];
  const flag = argv[0];

  if (flag === "--range") {
    messages.push(...commitsInRange(argv[1]));
  } else if (flag === "--file") {
    messages.push(readFileSync(argv[1], "utf8"));
  } else if (flag === "--last") {
    messages.push(execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" }));
  } else if (flag && !flag.startsWith("--")) {
    messages.push(argv.join(" "));
  } else {
    console.error(
      "Usage: check-commit.mjs <message> | --last | --file <path> | --range <base>..<head>",
    );
    process.exit(2);
  }

  let failed = 0;
  for (const message of messages) {
    const errors = lintMessage(message);
    const header = message.split("\n", 1)[0].trim();
    if (errors.length > 0) {
      failed++;
      console.error(`✗ ${header}`);
      for (const e of errors) console.error(`    - ${e}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} commit message(s) failed the Conventional Commits check.`);
    process.exit(1);
  }
  console.log(`✓ ${messages.length} commit message(s) OK.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2));
}
