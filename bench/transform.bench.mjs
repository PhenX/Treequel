#!/usr/bin/env node
// Microbenchmark for the per-module build transform (§ the transform perf
// budget). Requires the packages to be built (`npm run build --workspaces`)
// because it imports the published `@greffon/transform` entry.
//
//   node bench/transform.bench.mjs            # run and print a table
//   node bench/transform.bench.mjs --update   # rewrite bench/baseline.json
//   node bench/transform.bench.mjs --check     # fail if throughput fell below the baseline (local gate)
//   node bench/transform.bench.mjs --report    # print the comparison, never fail (CI advisory)
//
// The gate metric is `hitOpsPerSec`: the throughput of transforming a matching
// module — a real ~280µs parse, so ~1% run-to-run. It varies ~10% between
// machines, so --check gates against your own committed baseline and CI runs
// --report (advisory only — runner variance would otherwise redden every PR).
// The pre-scan bail is measured too, but only as an informational fast-path
// check: it is sub-microsecond, so its throughput is too noisy to gate on.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { transformModule } from "@greffon/transform";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "baseline.json");
const THRESHOLD = 0.3; // fail a --check when the ratio is > 30% above baseline.

// A realistic query module: a traced chain with several inline lambdas — nested
// lambdas, captures, method calls, an object projection — i.e. the work-heavy
// reify path. `db` is a traced root created in-module, so no host is needed.
const HIT = `import { createContext } from "@greffon/query";
const db = createContext(provider);
const prefix = "a";
const minAge = 18;
export const adults = db.users
  .where((u) => u.age >= minAge && u.name.startsWith(prefix))
  .where((u) => u.tags.some((t) => t.toLowerCase() === "vip"))
  .orderByDescending((u) => u.createdAt)
  .select((u) => ({ id: u.id, name: u.name.trim(), city: u.address.city }));
export const active = db.orders
  .where((o) => o.total > 100 && o.status !== "cancelled")
  .select((o) => ({ id: o.id, when: o.placedAt }));
`;

// A same-size module with no traced import and no expr( — the pre-scan bails.
const MISS = `import { formatCurrency } from "./format";
const RATE = 0.2;
export function totals(rows) {
  const withTax = rows.map((r) => r.amount * (1 + RATE));
  const sum = withTax.reduce((a, b) => a + b, 0);
  return { count: rows.length, sum, formatted: formatCurrency(sum) };
}
export function summarize(rows) {
  return rows.filter((r) => r.amount > 0).map((r) => r.label.toUpperCase());
}
`;

async function measure() {
  const bench = new Bench({ time: 400, warmupTime: 100 });
  bench
    .add("transform hit (reify)", async () => {
      await transformModule(HIT, "bench/hit.ts");
    })
    .add("transform miss (pre-scan bail)", async () => {
      await transformModule(MISS, "bench/miss.ts");
    });
  await bench.run();

  const hz = (name) => {
    const task = bench.tasks.find((t) => t.name === name);
    const mean = task?.result?.throughput?.mean;
    if (!mean) throw new Error(`no throughput for '${name}'`);
    return mean;
  };
  const hit = hz("transform hit (reify)");
  const miss = hz("transform miss (pre-scan bail)");
  return { hit, miss, table: bench.table() };
}

const mode = process.argv[2];
const { hit, miss, table } = await measure();
const fmt = (n) => Math.round(n).toLocaleString();

console.table(table);
console.log(`\ntransform: ${fmt(hit)} ops/s (hit) · ${fmt(miss)} ops/s (pre-scan bail)`);

if (mode === "--update") {
  const baseline = {
    note: "Gate metric is hitOpsPerSec (a real parse, ~1% run-to-run). It varies ~10% between machines, so --check is a local gate and CI runs --report.",
    threshold: THRESHOLD,
    hitOpsPerSec: Math.round(hit),
    missOpsPerSec: Math.round(miss),
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\nWrote ${baselinePath} (hit ${fmt(hit)} ops/s).`);
} else if (mode === "--check" || mode === "--report") {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const threshold = baseline.threshold ?? THRESHOLD;
  const floor = baseline.hitOpsPerSec * (1 - threshold);
  const pct = Math.round((hit / baseline.hitOpsPerSec - 1) * 100);
  console.log(
    `\nbaseline ${fmt(baseline.hitOpsPerSec)} ops/s · measured ${fmt(hit)} ops/s ` +
      `(${pct >= 0 ? "+" : ""}${pct}%) · floor ${fmt(floor)} ops/s`,
  );
  const regressed = hit < floor;
  // --report never fails: throughput varies ~10% between machines, so a
  // committed baseline can only advise across CI runners. --check is the local
  // hard gate against a baseline measured on the same machine.
  if (regressed && mode === "--check") {
    console.error(
      `\n✗ transform throughput fell ${-pct}% below baseline (> ${Math.round(threshold * 100)}%).`,
    );
    process.exit(1);
  }
  console.log(
    regressed
      ? `\n⚠ advisory: ${-pct}% below baseline — re-baseline with --update on your machine if this is expected.`
      : "\n✓ transform within the perf budget.",
  );
}
