#!/usr/bin/env node
// Microbenchmark for the per-module build transform (§ the transform perf
// budget). Requires the packages to be built (`npm run build --workspaces`)
// because it imports the published `@treequel/transform` entry.
//
//   node bench/transform.bench.mjs            # run and print a table
//   node bench/transform.bench.mjs --update   # rewrite bench/baseline.json
//   node bench/transform.bench.mjs --check    # fail if a regression exceeds the threshold
//
// The gate is machine-independent: absolute ops/sec vary with the runner, so
// the baseline stores the *ratio* of a matching-module transform to a
// non-matching pre-scan bail measured in the same process. A transform that
// slows down relative to that in-run reference raises the ratio; the check
// fails when it climbs more than THRESHOLD above the committed baseline.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { transformModule } from "@treequel/transform";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "baseline.json");
const THRESHOLD = 0.3; // fail a --check when the ratio is > 30% above baseline.

// A realistic query module: a traced chain with several inline lambdas — nested
// lambdas, captures, method calls, an object projection — i.e. the work-heavy
// reify path. `db` is a traced root created in-module, so no host is needed.
const HIT = `import { createContext } from "@treequel/linq";
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
  return { hit, miss, ratio: miss / hit, table: bench.table() };
}

const mode = process.argv[2];
const { hit, miss, ratio, table } = await measure();

console.table(table);
console.log(
  `\nhit: ${Math.round(hit).toLocaleString()} ops/s · ` +
    `miss: ${Math.round(miss).toLocaleString()} ops/s · ` +
    `ratio (miss/hit): ${ratio.toFixed(1)}×`,
);

if (mode === "--update") {
  const baseline = {
    note: "Machine-independent gate: 'ratio' (miss/hit) is normative; raw ops/s are informational.",
    threshold: THRESHOLD,
    ratio: Number(ratio.toFixed(3)),
    informational: { hitOpsPerSec: Math.round(hit), missOpsPerSec: Math.round(miss) },
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\nWrote ${baselinePath} (ratio ${baseline.ratio}).`);
} else if (mode === "--check") {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const limit = baseline.ratio * (1 + (baseline.threshold ?? THRESHOLD));
  const pct = ((ratio / baseline.ratio - 1) * 100).toFixed(0);
  console.log(
    `\nbaseline ratio ${baseline.ratio.toFixed(1)}× · measured ${ratio.toFixed(1)}× ` +
      `(${pct > 0 ? "+" : ""}${pct}%) · limit ${limit.toFixed(1)}×`,
  );
  if (ratio > limit) {
    console.error(
      `\n✗ transform is ~${pct}% slower relative to the pre-scan reference than baseline (> ${(
        (baseline.threshold ?? THRESHOLD) * 100
      ).toFixed(0)}%).`,
    );
    process.exit(1);
  }
  console.log("\n✓ transform within the perf budget.");
}
