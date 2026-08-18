#!/usr/bin/env node
// Lockstep release: bump every @greffon/* package to one shared version,
// rewrite internal "*" ranges to the concrete version, and prepend a changelog
// section rendered from the Conventional-Commit history. Plain Node, zero deps.
//
//   node scripts/release.mjs patch|minor|major [--dry-run]
//
// This script owns the deterministic file mutations only. Committing, tagging,
// pushing, and `npm publish --provenance` are the release workflow's job —
// provenance can only be produced from the CI OIDC context.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export function nextVersion(current, kind) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// Conventional-Commit types → changelog headings, in the order they render.
// Everything not listed here is folded into "Internal changes".
const HEADINGS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["docs", "Documentation"],
];
const INTERNAL = new Set(["refactor", "test", "build", "ci", "chore", "style", "revert"]);
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.+)$/;

/** Render a changelog section from commit-subject headers, newest-first order preserved. */
export function renderChangelog(version, date, headers) {
  const groups = new Map();
  const breaking = [];
  for (const header of headers) {
    const m = HEADER.exec(header.trim());
    if (!m || !m.groups) continue;
    const { type, scope, bang, subject } = m.groups;
    const entry = scope ? `${subject} (${scope})` : subject;
    if (bang) breaking.push(entry);
    const bucket = INTERNAL.has(type) ? "internal" : type;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(entry);
  }

  let out = `## v${version} — ${date}\n`;
  if (breaking.length > 0) {
    out += `\n### ⚠ Breaking changes\n\n${breaking.map((e) => `- ${e}`).join("\n")}\n`;
  }
  for (const [type, heading] of HEADINGS) {
    const items = groups.get(type);
    if (items && items.length > 0)
      out += `\n### ${heading}\n\n${items.map((e) => `- ${e}`).join("\n")}\n`;
  }
  const internal = groups.get("internal");
  if (internal && internal.length > 0) {
    out += `\n### Internal changes\n\n${internal.map((e) => `- ${e}`).join("\n")}\n`;
  }
  return out;
}

const MARKER = "<!-- releases -->";

/** Insert a rendered section directly below the marker in an existing changelog. */
export function insertChangelog(existing, section) {
  const idx = existing.indexOf(MARKER);
  if (idx === -1) return `${existing.trimEnd()}\n\n${MARKER}\n\n${section}`;
  const cut = idx + MARKER.length;
  return `${existing.slice(0, cut)}\n\n${section}${existing.slice(cut)}`;
}

// --- CLI ---------------------------------------------------------------------

function isoDate() {
  // Release stamp — a real timestamp is expected here (this is not a test).
  return new Date().toISOString().slice(0, 10);
}

function commitSubjectsSinceLastTag(root) {
  let range = [];
  try {
    const lastTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    range = [`${lastTag}..HEAD`];
  } catch {
    // No tag yet — the first release covers the whole history.
  }
  const out = execFileSync("git", ["log", "--no-merges", "--format=%s", ...range], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").filter((s) => s.trim().length > 0);
}

function run() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bump = process.argv[2] ?? "patch";
  const dryRun = process.argv.includes("--dry-run");

  if (!["patch", "minor", "major"].includes(bump)) {
    console.error("Usage: release.mjs patch|minor|major [--dry-run]");
    process.exit(1);
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
        if (dep.startsWith("@greffon/") && deps[dep] === "*") deps[dep] = `^${version}`;
      }
    }
    const isPublic = json.private !== true;
    publishPlan.push({ name: json.name, public: isPublic });
    console.log(`  ${isPublic ? "publish" : "  (private)"}  ${json.name}@${version}`);
    if (!dryRun) writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  }

  const section = renderChangelog(version, isoDate(), commitSubjectsSinceLastTag(root));
  const changelogPath = join(root, "CHANGELOG.md");
  const existing = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : "# Changelog\n";
  const updated = insertChangelog(existing, section);

  console.log(`\n--- CHANGELOG section ---\n${section}`);
  if (!dryRun) writeFileSync(changelogPath, updated);

  const publicCount = publishPlan.filter((p) => p.public).length;
  console.log(
    `${dryRun ? "Would" : "Wrote"} versions for ${pkgs.length} package(s); ` +
      `${publicCount} public package(s) to publish with provenance.`,
  );
  if (dryRun)
    console.log(
      "Re-run without --dry-run; the release workflow then commits, tags, and publishes.",
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
