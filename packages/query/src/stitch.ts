/**
 * The shared row-stitching engine: collect the distinct join keys of a set of
 * rows (`collectKeys`), read a stitch key strictly (`rowKey`), and attach
 * fetched children onto their parents in a provider-independent order
 * (`attachChildren`). Every provider — memory and SQL alike — stitches through
 * these, so include results agree on shape.
 */
import { GreffonError } from "@greffon/core";
import { canonical } from "./canon.js";
import type { IncludeSpec } from "./plan.js";

/**
 * Distinct, non-nullish join keys of `rows` read from `prop`. A row missing the
 * property is an error — the query projected the parent key away.
 */
export function collectKeys(rows: readonly unknown[], prop: string, nav: string): unknown[] {
  const seen = new Set<string>();
  const keys: unknown[] = [];
  for (const row of rows) {
    const key = rowKey(row, prop, nav);
    if (key === null || key === undefined) continue;
    const ck = canonical(key);
    if (!seen.has(ck)) {
      seen.add(ck);
      keys.push(key);
    }
  }
  return keys;
}

/** Read a stitch key strictly: a row without the property is a modeling error. */
export function rowKey(row: unknown, prop: string, nav: string): unknown {
  if (row === null || typeof row !== "object" || !(prop in row)) {
    throw new GreffonError(
      "R2002",
      `include('${nav}') requires the key '${prop}' to be present on the rows.`,
    );
  }
  return (row as Record<string, unknown>)[prop];
}

/**
 * Attach `children` to each parent under `spec.nav`, matching `parentProp` to
 * `childProp`. Parents are copied, never mutated. Children attach in canonical
 * order — deterministic across providers, since SQL row order is undefined —
 * unless the spec carries an explicit order (`preserveOrder`), in which case
 * the given sequence is kept. A spec's `take`/`skip` slice each parent's
 * bucket, after ordering.
 */
export function attachChildren(
  parents: readonly unknown[],
  spec: IncludeSpec,
  children: readonly unknown[],
  parentProp: string,
  childProp: string,
  preserveOrder = false,
): unknown[] {
  const buckets = new Map<string, unknown[]>();
  const ordered = preserveOrder
    ? children
    : [...children].sort((a, b) => {
        const ca = canonical(a);
        const cb = canonical(b);
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
  for (const child of ordered) {
    const key = rowKey(child, childProp, spec.nav);
    if (key === null || key === undefined) continue;
    const ck = canonical(key);
    const bucket = buckets.get(ck);
    if (bucket) bucket.push(child);
    else buckets.set(ck, [child]);
  }
  const from = spec.skip ?? 0;
  const to = spec.take !== undefined ? from + spec.take : undefined;
  return parents.map((parent) => {
    const key = rowKey(parent, parentProp, spec.nav);
    const matches = key === null || key === undefined ? undefined : buckets.get(canonical(key));
    const sliced = matches && (from > 0 || to !== undefined) ? matches.slice(from, to) : matches;
    const value = spec.kind === "many" ? (sliced ?? []) : (sliced?.[0] ?? null);
    return Object.assign({}, parent, { [spec.nav]: value });
  });
}
