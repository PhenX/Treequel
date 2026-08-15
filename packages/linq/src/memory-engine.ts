import { canonical } from "./canon.js";
import { attachChildren, collectIncludes, collectKeys, rowKey } from "./include.js";
import type { AnyExpr, IncludeSpec, PlanOp, QueryPlan } from "./plan.js";

/**
 * The reference in-memory semantics: apply plan ops to plain arrays using each
 * expression's `compiled` function. This engine *is* the reference every other
 * provider is tested against; it lives in `linq` so both
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

export function runPlanInMemory(plan: QueryPlan, rows: RowSource): unknown {
  return applyOps([...rows(plan.source)], plan.ops, rows);
}

/** Apply a sequence of ops to an array; an `exec` op returns the final result. */
export function applyOps(start: unknown[], ops: readonly PlanOp[], rows: RowSource): unknown {
  const includes = collectIncludes(ops);
  let cur = start;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as PlanOp;
    switch (op.op) {
      case "where":
        cur = cur.filter((r) => Boolean(invoke(op.expr, r)));
        break;
      case "select":
        cur = cur.map((r) => invoke(op.expr, r));
        break;
      case "orderBy": {
        const keys: Array<{ expr: AnyExpr; desc: boolean }> = [{ expr: op.expr, desc: op.desc }];
        while (i + 1 < ops.length && (ops[i + 1] as PlanOp).op === "thenBy") {
          const next = ops[++i] as Extract<PlanOp, { op: "orderBy" | "thenBy" }>;
          keys.push({ expr: next.expr, desc: next.desc });
        }
        cur = sortBy(cur, keys);
        break;
      }
      case "thenBy":
        // Only reached if a thenBy appears without a preceding orderBy; treat as a fresh sort.
        cur = sortBy(cur, [{ expr: op.expr, desc: op.desc }]);
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
      case "groupBy":
        cur = groupBy(cur, op.expr) as unknown[];
        break;
      case "join":
      case "leftJoin":
        cur = hashJoin(cur, op, rows);
        break;
      case "include":
        break; // collected up front; navigations attach to the final rows below
      case "inMemory":
        break; // boundary marker — a no-op inside a pure memory run
      case "exec":
        if (rowResult(op.kind)) cur = applyIncludes(cur, includes, rows);
        return execute(cur, op);
    }
  }
  return applyIncludes(cur, includes, rows);
}

const rowResult = (kind: Extract<PlanOp, { op: "exec" }>["kind"]): boolean =>
  kind === "toArray" || kind === "first" || kind === "single";

/**
 * Attach each navigation's related rows to the final rows. Parents are copied
 * on attach; related rows are fetched by key from the row source and stitched
 * with the shared engine so every provider agrees on the result shape.
 */
function applyIncludes(
  parents: unknown[],
  specs: readonly IncludeSpec[],
  rows: RowSource,
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
    if (spec.children && spec.children.length > 0) {
      children = applyIncludes(children, spec.children, rows);
    }
    cur = attachChildren(cur, spec, children, spec.from, spec.to);
  }
  return cur;
}

function sortBy(rows: unknown[], keys: Array<{ expr: AnyExpr; desc: boolean }>): unknown[] {
  // Array.prototype.sort is stable in modern engines; that gives thenBy for free.
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const cmp = compare(invoke(k.expr, a), invoke(k.expr, b));
      if (cmp !== 0) return k.desc ? -cmp : cmp;
    }
    return 0;
  });
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

function groupBy(rows: unknown[], keyExpr: AnyExpr): Array<Grouping<unknown, unknown>> {
  const map = new Map<string, { key: unknown; items: unknown[] }>();
  const order: string[] = [];
  for (const r of rows) {
    const key = invoke(keyExpr, r);
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
  const innerRows = applyOps([...rows(op.inner.source)], op.inner.ops, rows) as unknown[];
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

function execute(rows: unknown[], op: Extract<PlanOp, { op: "exec" }>): unknown {
  const filtered =
    op.expr &&
    (op.kind === "first" || op.kind === "single" || op.kind === "count" || op.kind === "any")
      ? rows.filter((r) => Boolean(invoke(op.expr as AnyExpr, r)))
      : rows;

  switch (op.kind) {
    case "toArray":
      return rows;
    case "first":
      if (filtered.length === 0) {
        if (op.orNull) return null;
        throw new Error("Treequel: first() found no element.");
      }
      return filtered[0];
    case "single":
      if (filtered.length === 0) {
        if (op.orNull) return null;
        throw new Error("Treequel: single() found no element.");
      }
      if (filtered.length > 1) throw new Error("Treequel: single() found more than one element.");
      return filtered[0];
    case "count":
      return filtered.length;
    case "any":
      return filtered.length > 0;
    case "all":
      return rows.every((r) => Boolean(invoke(op.expr as AnyExpr, r)));
    case "sum":
      return rows.reduce<number>((acc, r) => acc + Number(invoke(op.expr as AnyExpr, r)), 0);
    case "min":
      return rows.length === 0
        ? null
        : rows.reduce<number>(
            (m, r) => Math.min(m, Number(invoke(op.expr as AnyExpr, r))),
            Infinity,
          );
    case "max":
      return rows.length === 0
        ? null
        : rows.reduce<number>(
            (m, r) => Math.max(m, Number(invoke(op.expr as AnyExpr, r))),
            -Infinity,
          );
    case "avg":
      return rows.length === 0
        ? null
        : rows.reduce<number>((acc, r) => acc + Number(invoke(op.expr as AnyExpr, r)), 0) /
            rows.length;
  }
}
