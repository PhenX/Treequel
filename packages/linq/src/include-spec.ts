/**
 * Building and merging the `IncludeSpec` trees behind `include()`/`thenInclude()`.
 * `navName` reads a navigation selector, `resolveRelation` looks it up in the
 * relations map, and `appendChild`/`chainTail`/`mergeIncludeSpecs`/`collectIncludes`
 * assemble and de-duplicate the specs a plan carries. Pure spec data — no rows.
 */
import { TreequelError, isExpr } from "@treequel/core";
import type { IncludeSpec, PlanOp } from "./plan.js";
import type { Relation, RelationsMeta } from "./relations.js";

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

const isRefined = (s: IncludeSpec): boolean =>
  (s.ops !== undefined && s.ops.length > 0) || s.take !== undefined || s.skip !== undefined;

/**
 * Merge include specs by navigation name, per level: repeating
 * `.include(u => u.orders)` to reach sibling nested navigations yields one
 * fetch of `orders` with the children of every mention. A *refined* include
 * (filter/order/slice) must be stated exactly once per navigation — merging
 * two refinements silently would guess at semantics.
 */
export function mergeIncludeSpecs(specs: readonly IncludeSpec[]): IncludeSpec[] {
  const byNav = new Map<string, IncludeSpec>();
  for (const spec of specs) {
    const prev = byNav.get(spec.nav);
    if (!prev) {
      byNav.set(spec.nav, spec);
    } else {
      if (isRefined(prev) || isRefined(spec)) {
        throw new TreequelError(
          "R2008",
          `The refined include('${spec.nav}') may be stated once; chain thenInclude() from that single statement.`,
        );
      }
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
