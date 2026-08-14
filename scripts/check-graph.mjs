#!/usr/bin/env node
// Enforces the dependency graph with zero framework dependencies.
// Fails CI if any package's runtime `dependencies` stray from the allowlist,
// if a runtime package grows a third-party dependency, or if a cycle appears.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Runtime packages must have ZERO third-party runtime dependencies (headline feature).
const RUNTIME = new Set(["tree", "core", "linq", "provider-memory", "provider-sql"]);

// Allowed runtime dependencies per package: internal @treequel/* names + external pkgs.
const ALLOWED = {
  tree: { internal: [], external: [] },
  core: { internal: ["tree"], external: [] },
  capture: { internal: ["tree"], external: [] },
  linq: { internal: ["core"], external: [] },
  "provider-memory": { internal: ["core", "linq"], external: [] },
  "provider-sql": { internal: ["core", "linq"], external: [] },
  transform: { internal: ["capture"], external: ["oxc-parser", "magic-string"] },
  vite: { internal: ["transform"], external: [] },
  fallback: { internal: ["core", "capture"], external: ["meriyah"] },
  "ts-plugin": { internal: ["capture"], external: ["oxc-parser"] },
  "eslint-plugin": { internal: ["capture"], external: [] },
};

const errors = [];
const graph = new Map();

const pkgDir = join(root, "packages");
for (const name of readdirSync(pkgDir)) {
  const pj = join(pkgDir, name, "package.json");
  if (!existsSync(pj)) continue;
  const json = JSON.parse(readFileSync(pj, "utf8"));
  const short = json.name.replace("@treequel/", "");
  const spec = ALLOWED[short];
  if (!spec) {
    errors.push(`Unknown package '${short}' — add it to check-graph ALLOWED.`);
    continue;
  }

  const deps = Object.keys(json.dependencies ?? {});
  const internal = [];
  for (const dep of deps) {
    if (dep.startsWith("@treequel/")) {
      const target = dep.replace("@treequel/", "");
      internal.push(target);
      if (!spec.internal.includes(target)) {
        errors.push(
          `${short}: illegal internal dependency on '${dep}' (not in the allowed edges).`,
        );
      }
    } else {
      if (RUNTIME.has(short)) {
        errors.push(`${short}: runtime package must have ZERO third-party deps, found '${dep}'.`);
      } else if (!spec.external.includes(dep)) {
        errors.push(`${short}: unexpected third-party dependency '${dep}'.`);
      }
    }
  }
  graph.set(short, internal);
}

// Cycle detection (DFS) over internal edges.
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
const stack = [];
function dfs(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const next of graph.get(node) ?? []) {
    if (color.get(next) === GRAY) {
      errors.push(`Dependency cycle: ${[...stack, next].join(" -> ")}`);
    } else if (color.get(next) === WHITE) {
      dfs(next);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}
for (const node of graph.keys()) if (color.get(node) === WHITE) dfs(node);

// apps/* and examples/* must be private.
for (const group of ["apps", "examples"]) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const pj = join(dir, name, "package.json");
    if (!existsSync(pj)) continue;
    const json = JSON.parse(readFileSync(pj, "utf8"));
    if (json.private !== true) errors.push(`${group}/${name}: must set "private": true.`);
  }
}

if (errors.length > 0) {
  console.error("✗ Dependency graph check failed:\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ Dependency graph OK (${graph.size} packages, acyclic, edges within the allowlist).`);
