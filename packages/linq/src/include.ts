import { type Node, TreequelError, children, isExpr } from "@treequel/core";
import { canonical } from "./canon.js";
import type { AnyExpr, IncludeSpec, PlanOp } from "./plan.js";
import type { Relation, RelationsMeta } from "./relations.js";

/**
 * Navigation resolution and the shared stitching engine behind `include()`.
 * Providers fetch related rows however they like (fixture arrays, batched SQL);
 * key collection, grouping and attachment live here so every provider agrees.
 */

/**
 * Read the navigation property name from a selector like `u => u.orders` by
 * invoking it with a recording proxy. Works on the plain function or an
 * `Expr`'s `compiled` — no expression tree required, in any build mode.
 */
export function navName(selector: unknown): string {
  const fn = isExpr(selector) ? selector.compiled : selector;
  if (typeof fn !== "function") {
    throw new TreequelError("R2008", "include()/thenInclude() expects a navigation selector.");
  }
  const path: string[] = [];
  const probe: object = new Proxy(Object.create(null) as object, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      path.push(prop);
      return probe;
    },
  });
  const out = (fn as (x: unknown) => unknown)(probe);
  if (out !== probe || path.length !== 1) {
    throw new TreequelError(
      "R2008",
      "A navigation selector must be a single property access (`u => u.orders`); " +
        "chain .thenInclude() for nested navigations.",
    );
  }
  return path[0] as string;
}

/** Resolve `nav` on `source` against the relation metadata, or fail with R2007. */
export function resolveRelation(
  relations: RelationsMeta | undefined,
  source: string,
  nav: string,
): Relation {
  const rel = relations?.[source]?.[nav];
  if (!rel) {
    throw new TreequelError(
      "R2007",
      `Unknown navigation '${nav}' on source '${source}'. ` +
        "Declare it in the relations map passed to createContext(provider, { relations }).",
    );
  }
  return rel;
}

/** Append `child` at the tail of `spec`'s thenInclude chain, immutably. */
export function appendChild(spec: IncludeSpec, child: IncludeSpec): IncludeSpec {
  const tail = spec.children?.[spec.children.length - 1];
  return tail ? { ...spec, children: [appendChild(tail, child)] } : { ...spec, children: [child] };
}

/** The deepest spec of a thenInclude chain — where the next level attaches. */
export function chainTail(spec: IncludeSpec): IncludeSpec {
  let cur = spec;
  while (cur.children && cur.children.length > 0) {
    cur = cur.children[cur.children.length - 1] as IncludeSpec;
  }
  return cur;
}

/**
 * Merge include specs by navigation name, per level: repeating
 * `.include(u => u.orders)` to reach sibling nested navigations yields one
 * fetch of `orders` with the children of every mention.
 */
export function mergeIncludeSpecs(specs: readonly IncludeSpec[]): IncludeSpec[] {
  const byNav = new Map<string, IncludeSpec>();
  for (const spec of specs) {
    const prev = byNav.get(spec.nav);
    if (!prev) {
      byNav.set(spec.nav, spec);
    } else {
      byNav.set(spec.nav, {
        ...prev,
        children: mergeIncludeSpecs([...(prev.children ?? []), ...(spec.children ?? [])]),
      });
    }
  }
  return [...byNav.values()].map((s) =>
    s.children ? Object.assign({}, s, { children: mergeIncludeSpecs(s.children) }) : s,
  );
}

/** All include specs of a plan, merged. */
export function collectIncludes(ops: readonly PlanOp[]): IncludeSpec[] {
  const specs = ops.filter((o) => o.op === "include").map((o) => o.spec);
  return mergeIncludeSpecs(specs);
}

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

/**
 * Navigations referenced by a predicate/selector tree, as include specs: a
 * `Member(param, nav)` hit becomes a spec, and a `.some(…)`/`.every(…)` call
 * over it descends into the nested lambda against the navigation's target.
 * Rows augmented with these specs make the compiled lambda evaluable in
 * memory — the exact rows SQL reasons about with correlated subqueries.
 */
export function predicateSpecs(
  body: Node,
  param: string | undefined,
  source: string,
  relations: RelationsMeta | undefined,
): IncludeSpec[] {
  if (!param || !relations) return [];
  const specs: IncludeSpec[] = [];
  const navOf = (n: Node): Relation | undefined =>
    n.kind === "Member" && n.object.kind === "Param" && n.object.name === param
      ? relations[source]?.[n.prop]
      : undefined;

  const walk = (n: Node): void => {
    if (n.kind === "Call" && n.callee.kind === "Member") {
      const rel = navOf(n.callee.object);
      const lambda = n.args[0];
      if (
        rel &&
        (n.callee.prop === "some" || n.callee.prop === "every") &&
        lambda?.kind === "Lambda"
      ) {
        specs.push({
          nav: (n.callee.object as Extract<Node, { kind: "Member" }>).prop,
          ...rel,
          children: predicateSpecs(lambda.body, lambda.params[0], rel.target, relations),
        });
        for (const arg of n.args.slice(1)) walk(arg);
        return;
      }
    }
    const rel = navOf(n);
    if (rel) {
      specs.push({ nav: (n as Extract<Node, { kind: "Member" }>).prop, ...rel });
      return;
    }
    for (const child of children(n)) walk(child);
  };
  walk(body);
  return mergeIncludeSpecs(specs);
}

/** `expr.body` when a tree is available; `null` when no plugin/fallback ran. */
export function tryBody(e: AnyExpr): Node | null {
  try {
    return e.body;
  } catch (err) {
    if (err instanceof TreequelError && err.code === "R3001") return null;
    throw err;
  }
}

/**
 * Best-effort guard for tree-less lambdas: invoke `compiled` with a recording
 * proxy row and report which root properties it touches. Lets the memory
 * engine refuse navigation predicates it cannot resolve instead of silently
 * evaluating them against absent data.
 */
export function touchedRootProps(fn: (...a: never[]) => unknown): Set<string> {
  const touched = new Set<string>();
  const inner: unknown = makeOpaqueProxy();
  const root: object = new Proxy(Object.create(null) as object, {
    get(_t, prop) {
      if (typeof prop === "string") touched.add(prop);
      else if (prop === Symbol.toPrimitive) return () => "";
      return inner;
    },
  });
  try {
    (fn as (x: unknown) => unknown)(root);
  } catch {
    // Opaque helpers may throw on proxy values; the touch log stays valid.
  }
  return touched;
}

function makeOpaqueProxy(): unknown {
  const target = (): void => undefined;
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      return proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

/** Read a stitch key strictly: a row without the property is a modeling error. */
export function rowKey(row: unknown, prop: string, nav: string): unknown {
  if (row === null || typeof row !== "object" || !(prop in row)) {
    throw new TreequelError(
      "R2002",
      `include('${nav}') requires the key '${prop}' to be present on the rows.`,
    );
  }
  return (row as Record<string, unknown>)[prop];
}

/**
 * Attach `children` to each parent under `spec.nav`, matching `parentProp` to
 * `childProp`. Parents are copied, never mutated. Children attach in canonical
 * order — deterministic across providers, since SQL row order is undefined.
 */
export function attachChildren(
  parents: readonly unknown[],
  spec: IncludeSpec,
  children: readonly unknown[],
  parentProp: string,
  childProp: string,
): unknown[] {
  const buckets = new Map<string, unknown[]>();
  const ordered = [...children].sort((a, b) => {
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
  return parents.map((parent) => {
    const key = rowKey(parent, parentProp, spec.nav);
    const matches = key === null || key === undefined ? undefined : buckets.get(canonical(key));
    const value = spec.kind === "many" ? (matches ?? []) : (matches?.[0] ?? null);
    return Object.assign({}, parent, { [spec.nav]: value });
  });
}
