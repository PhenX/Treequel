import { GreffonError } from "@greffon/core";
import { canonical } from "./canon.js";
import { collectIncludes } from "./include-spec.js";
import { predicateSpecs, touchedRootProps, tryBody } from "./navpredicates.js";
import { attachChildren, collectKeys, rowKey } from "./stitch.js";
import type { AnyExpr, IncludeSpec, PlanOp, QueryPlan } from "./plan.js";
import type { RelationsMeta } from "./relations.js";

/**
 * The reference in-memory semantics: apply plan ops to plain arrays using each
 * expression's `compiled` function. This engine *is* the reference every other
 * provider is tested against; it lives in `query` so both
 * `provider-memory` and the `.inMemory()` boundary reuse one implementation.
 */

/** A materialized group, mirroring C#'s `IGrouping<K,T>`. */
export interface Grouping<K, T> extends Iterable<T> {
  readonly key: K;
  readonly items: readonly T[];
}

/** Resolve the backing rows for a source name (fixtures / tables). */
export type RowSource = (source: string) => readonly unknown[];

const invoke = (e: AnyExpr, ...args: unknown[]): unknown =>
  (e.compiled as (...a: unknown[]) => unknown)(...args);

/** Where the current rows came from — resolves navigations in predicates. */
export interface PlanEnv {
  readonly source?: string;
  readonly relations?: RelationsMeta;
}

export function runPlanInMemory(plan: QueryPlan, rows: RowSource): unknown {
  return applyOps([...rows(plan.source)], plan.ops, rows, {
    source: plan.source,
    ...(plan.relations ? { relations: plan.relations } : {}),
  });
}

/**
 * Rows to evaluate a predicate against: when its tree references declared
 * navigations, a copy of each row with those navigations attached (the rows a
 * SQL provider reasons about via correlated subqueries); otherwise `null`,
 * and the predicate runs over the rows as-is. Without a tree (no plugin, no
 * fallback), a compiled lambda that touches a navigation is refused rather
 * than silently evaluated against absent data.
 */
function navEvalRows(cur: unknown[], e: AnyExpr, env: PlanEnv, rows: RowSource): unknown[] | null {
  const navs = env.source ? env.relations?.[env.source] : undefined;
  if (!navs || cur.length === 0) return null;
  const body = tryBody(e);
  if (body === null) {
    for (const prop of touchedRootProps(e.compiled)) {
      if (navs[prop]) {
        throw new GreffonError(
          "R3001",
          `This lambda reads the navigation '${prop}', which needs an expression tree to resolve. ` +
            'Enable the @greffon/vite build plugin or `import "@greffon/fallback/register"`.',
        );
      }
    }
    return null;
  }
  const specs = predicateSpecs(body, e.params[0], env.source as string, env.relations);
  if (specs.length === 0) return null;
  return applyIncludes(cur, specs, rows, env.relations);
}

/** Apply a sequence of ops to an array; an `exec` op returns the final result. */
export function applyOps(
  start: unknown[],
  ops: readonly PlanOp[],
  rows: RowSource,
  env: PlanEnv = {},
): unknown {
  const includes = collectIncludes(ops);
  let cur = start;
  // Navigations resolve on source-shaped rows only: once a map/groupBy/join
  // reshapes the element, later expressions run over what they were given.
  let scope = env;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as PlanOp;
    switch (op.op) {
      case "filter": {
        const ev = navEvalRows(cur, op.expr, scope, rows) ?? cur;
        cur = cur.filter((_r, j) => Boolean(invoke(op.expr, ev[j])));
        break;
      }
      case "map": {
        const ev = navEvalRows(cur, op.expr, scope, rows) ?? cur;
        cur = cur.map((_r, j) => invoke(op.expr, ev[j]));
        scope = {};
        break;
      }
      case "orderBy": {
        const keys: Array<{ expr: AnyExpr; desc: boolean }> = [{ expr: op.expr, desc: op.desc }];
        while (i + 1 < ops.length && (ops[i + 1] as PlanOp).op === "thenBy") {
          const next = ops[++i] as Extract<PlanOp, { op: "orderBy" | "thenBy" }>;
          keys.push({ expr: next.expr, desc: next.desc });
        }
        cur = sortBy(cur, keys, scope, rows);
        break;
      }
      case "thenBy":
        // Only reached if a thenBy appears without a preceding orderBy; treat as a fresh sort.
        cur = sortBy(cur, [{ expr: op.expr, desc: op.desc }], scope, rows);
        break;
      case "take":
        cur = cur.slice(0, Math.max(0, op.n));
        break;
      case "skip":
        cur = cur.slice(Math.max(0, op.n));
        break;
      case "distinct":
        cur = distinct(cur);
        break;
      case "groupBy": {
        const ev = navEvalRows(cur, op.expr, scope, rows) ?? cur;
        cur = groupBy(cur, op.expr, ev) as unknown[];
        scope = {};
        break;
      }
      case "join":
      case "leftJoin":
        cur = hashJoin(cur, op, rows);
        scope = {};
        break;
      case "flatMap": {
        cur = flatMap(cur, op, rows);
        scope = op.result
          ? {}
          : { source: op.target, ...(env.relations ? { relations: env.relations } : {}) };
        break;
      }
      case "include":
        break; // collected up front; navigations attach to the final rows below
      case "inMemory":
        break; // boundary marker — a no-op inside a pure memory run
      case "exec": {
        if (rowResult(op.kind)) cur = applyIncludes(cur, includes, rows, env.relations);
        const ev = op.expr ? navEvalRows(cur, op.expr, scope, rows) : null;
        return execute(cur, op, ev ?? cur);
      }
    }
  }
  return applyIncludes(cur, includes, rows, env.relations);
}

const rowResult = (kind: Extract<PlanOp, { op: "exec" }>["kind"]): boolean =>
  kind === "toArray" || kind === "first" || kind === "single";

/**
 * Attach each navigation's related rows to the final rows. Parents are copied
 * on attach; related rows are fetched by key from the row source, refined by
 * the spec's ops (filter/order — slices apply per parent at attach), and
 * stitched with the shared engine so every provider agrees on the shape.
 */
function applyIncludes(
  parents: unknown[],
  specs: readonly IncludeSpec[],
  rows: RowSource,
  relations?: RelationsMeta,
): unknown[] {
  let cur = parents;
  for (const spec of specs) {
    if (cur.length === 0) break;
    const keys = collectKeys(cur, spec.from, spec.nav);
    const wanted = new Set(keys.map((k) => canonical(k)));
    let children = (rows(spec.target) as unknown[]).filter((child) => {
      const key = rowKey(child, spec.to, spec.nav);
      return key !== null && key !== undefined && wanted.has(canonical(key));
    });
    if (spec.ops && spec.ops.length > 0) {
      children = applyOps(children, spec.ops, rows, {
        source: spec.target,
        ...(relations ? { relations } : {}),
      }) as unknown[];
    }
    if (spec.children && spec.children.length > 0) {
      children = applyIncludes(children, spec.children, rows, relations);
    }
    const ordered = spec.ops?.some((o) => o.op === "orderBy") ?? false;
    cur = attachChildren(cur, spec, children, spec.from, spec.to, ordered);
  }
  return cur;
}

function sortBy(
  rows: unknown[],
  keys: Array<{ expr: AnyExpr; desc: boolean }>,
  env: PlanEnv,
  src: RowSource,
): unknown[] {
  // Key values are computed once per row (navigation keys evaluate against
  // augmented copies); Array.prototype.sort is stable in modern engines, which
  // gives thenBy for free.
  const decorated = rows.map((r) => ({ r, k: [] as unknown[] }));
  for (const key of keys) {
    const ev = navEvalRows(rows, key.expr, env, src) ?? rows;
    decorated.forEach((d, i) => d.k.push(invoke(key.expr, ev[i])));
  }
  return decorated
    .sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const cmp = compare(a.k[i], b.k[i]);
        if (cmp !== 0) return (keys[i] as { desc: boolean }).desc ? -cmp : cmp;
      }
      return 0;
    })
    .map((d) => d.r);
}

/**
 * Total order used by both the reference and (mirrored by) the SQL provider.
 * null/undefined sort *last* under ascending — negating for `desc` then makes
 * them sort first, matching Postgres NULLS LAST (asc) / NULLS FIRST (desc).
 */
function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function distinct(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const r of rows) {
    const key = canonical(r);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function groupBy(
  rows: unknown[],
  keyExpr: AnyExpr,
  evalRows: unknown[],
): Array<Grouping<unknown, unknown>> {
  const map = new Map<string, { key: unknown; items: unknown[] }>();
  const order: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = invoke(keyExpr, evalRows[i]);
    const ck = canonical(key);
    let bucket = map.get(ck);
    if (!bucket) {
      bucket = { key, items: [] };
      map.set(ck, bucket);
      order.push(ck);
    }
    bucket.items.push(r);
  }
  return order.map((ck) => {
    const { key, items } = map.get(ck) as { key: unknown; items: unknown[] };
    return {
      key,
      items,
      [Symbol.iterator]: () => items[Symbol.iterator](),
    } satisfies Grouping<unknown, unknown>;
  });
}

/**
 * A join key that never matches: null/undefined, or a composite (plain object)
 * with a null/undefined member — mirroring SQL, where `NULL = x` is never true.
 */
function joinKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (v === null || v === undefined) return null;
    }
  }
  return canonical(value);
}

function hashJoin(
  outer: unknown[],
  op: Extract<PlanOp, { op: "join" | "leftJoin" }>,
  rows: RowSource,
): unknown[] {
  const left = op.op === "leftJoin";
  const innerRows = applyOps([...rows(op.inner.source)], op.inner.ops, rows, {
    source: op.inner.source,
    ...(op.inner.relations ? { relations: op.inner.relations } : {}),
  }) as unknown[];
  const index = new Map<string, unknown[]>();
  for (const ir of innerRows) {
    const key = joinKey(invoke(op.innerKey, ir));
    if (key === null) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(ir);
    else index.set(key, [ir]);
  }
  const out: unknown[] = [];
  for (const or of outer) {
    const key = joinKey(invoke(op.outerKey, or));
    const matches = key === null ? undefined : index.get(key);
    if (!matches) {
      if (left) out.push(invoke(op.result, or, null));
      continue;
    }
    for (const ir of matches) out.push(invoke(op.result, or, ir));
  }
  return out;
}

/**
 * `evalRows` is aligned with `rows` and carries navigation-augmented copies
 * when the expr needs them; results always come from the original `rows`.
 */
/** Expand each row through its navigation — null keys expand to nothing. */
function flatMap(
  parents: unknown[],
  op: Extract<PlanOp, { op: "flatMap" }>,
  rows: RowSource,
): unknown[] {
  const index = new Map<string, unknown[]>();
  for (const child of rows(op.target)) {
    const key = rowKey(child, op.to, op.nav);
    if (key === null || key === undefined) continue;
    const ck = canonical(key);
    const bucket = index.get(ck);
    if (bucket) bucket.push(child);
    else index.set(ck, [child]);
  }
  const out: unknown[] = [];
  for (const parent of parents) {
    const key = rowKey(parent, op.from, op.nav);
    if (key === null || key === undefined) continue;
    const matches = index.get(canonical(key));
    if (!matches) continue;
    for (const child of matches) {
      out.push(op.result ? invoke(op.result, parent, child) : child);
    }
  }
  return out;
}

function execute(
  rows: unknown[],
  op: Extract<PlanOp, { op: "exec" }>,
  evalRows: unknown[],
): unknown {
  const test = (i: number): boolean => Boolean(invoke(op.expr as AnyExpr, evalRows[i]));
  const value = (i: number): number => Number(invoke(op.expr as AnyExpr, evalRows[i]));
  const filtered =
    op.expr &&
    (op.kind === "first" || op.kind === "single" || op.kind === "count" || op.kind === "some")
      ? rows.filter((_r, i) => test(i))
      : rows;

  switch (op.kind) {
    case "toArray":
      return rows;
    case "first":
      if (filtered.length === 0) {
        if (op.orNull) return null;
        throw new Error("Greffon: firstOrThrow() found no element.");
      }
      return filtered[0];
    case "single":
      if (filtered.length === 0) {
        if (op.orNull) return null;
        throw new Error("Greffon: single() found no element.");
      }
      if (filtered.length > 1) throw new Error("Greffon: single() found more than one element.");
      return filtered[0];
    case "count":
      return filtered.length;
    case "some":
      return filtered.length > 0;
    case "every":
      return rows.every((_r, i) => test(i));
    case "sum":
      return rows.reduce<number>((acc, _r, i) => acc + value(i), 0);
    case "min":
      return rows.length === 0
        ? null
        : rows.reduce<number>((m, _r, i) => Math.min(m, value(i)), Infinity);
    case "max":
      return rows.length === 0
        ? null
        : rows.reduce<number>((m, _r, i) => Math.max(m, value(i)), -Infinity);
    case "avg":
      return rows.length === 0
        ? null
        : rows.reduce<number>((acc, _r, i) => acc + value(i), 0) / rows.length;
  }
}
