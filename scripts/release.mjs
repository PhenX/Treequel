#!/usr/bin/env node
// Lockstep release: bump every @treequel/* package to one shared version,
// rewrite internal "*" ranges to the concrete version, and print/execute a
// publish plan. Plain Node, zero dependencies.
//
//   node scripts/release.mjs patch|minor|major [--dry-run]

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bump = process.argv[2] ?? "patch";
const dryRun = process.argv.includes("--dry-run");

if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`Usage: release.mjs patch|minor|major [--dry-run]`);
  process.exit(1);
}

function nextVersion(current, kind) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const pkgDir = join(root, "packages");
const pkgs = [];
for (const name of readdirSync(pkgDir)) {
  const path = join(pkgDir, name, "package.json");
  if (existsSync(path)) pkgs.push({ path, json: JSON.parse(readFileSync(path, "utf8")) });
}

const current = pkgs[0]?.json.version ?? "0.0.0";
const version = nextVersion(current, bump);

console.log(`Lockstep release: ${current} → ${version}  (${dryRun ? "dry-run" : "LIVE"})\n`);

const publishPlan = [];
for (const { path, json } of pkgs) {
  json.version = version;
  for (const field of ["dependencies", "peerDependencies"]) {
    const deps = json[field];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith("@treequel/") && deps[dep] === "*") deps[dep] = `^${version}`;
    }
  }
  const isPublic = json.private !== true;
  publishPlan.push({ name: json.name, public: isPublic });
  console.log(`  ${isPublic ? "publish" : "  (private)"}  ${json.name}@${version}`);
  if (!dryRun) writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

console.log(
  `\n${dryRun ? "Would" : "Will"} publish ${publishPlan.filter((p) => p.public).length} public package(s) with provenance.`,
);
if (dryRun) console.log("Re-run without --dry-run to write versions, then `npm publish --provenance` per package.");
