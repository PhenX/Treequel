/**
 * Finding the navigations a predicate or selector references, so the memory
 * engine can augment rows with exactly the related data a SQL provider would
 * reach via correlated subqueries. `predicateSpecs` walks an expression tree
 * (`u.orders.some(…)`, `u.orders.length`, the reduce idiom); `tryBody` and
 * `touchedRootProps` handle the tree-less fallback path.
 */
import { type Node, TreequelError, children } from "@treequel/core";
import type { AnyExpr, IncludeSpec } from "./plan.js";
import type { Relation, RelationsMeta } from "./relations.js";
import { mergeIncludeSpecs } from "./include-spec.js";

/**
 * A navigation reference inside an expression: `param.nav` optionally extended
 * by `.filter(l)` steps. Terminal calls (`some`/`every`/`reduce`/`.length`)
 * are matched by the callers; the chain carries every nested lambda together
 * with its *element* parameter name so child navigations resolve recursively.
 */
interface NavChain {
  readonly nav: string;
  readonly rel: Relation;
  readonly lambdas: ReadonlyArray<{ readonly body: Node; readonly param: string | undefined }>;
}

/** Match `param.nav` or `param.nav.filter(l)…` rooted at `param`. */
function matchNavChain(
  n: Node,
  param: string,
  source: string,
  relations: RelationsMeta,
): NavChain | null {
  if (n.kind === "Member" && n.object.kind === "Param" && n.object.name === param) {
    const rel = relations[source]?.[n.prop];
    return rel ? { nav: n.prop, rel, lambdas: [] } : null;
  }
  if (
    n.kind === "Call" &&
    n.callee.kind === "Member" &&
    n.callee.prop === "filter" &&
    n.args[0]?.kind === "Lambda"
  ) {
    const base = matchNavChain(n.callee.object, param, source, relations);
    if (!base) return null;
    const l = n.args[0];
    return { ...base, lambdas: [...base.lambdas, { body: l.body, param: l.params[0] }] };
  }
  return null;
}

/**
 * Navigations referenced by a predicate/selector tree, as include specs: a
 * navigation chain (`u.orders`, `u.orders.filter(…)`) becomes a spec, and
 * every nested lambda — quantifier predicates, filter steps, the reduce
 * accumulator — descends against the navigation's target. Rows augmented with
 * these specs make the compiled lambda evaluable in memory — the exact rows
 * SQL reasons about with correlated subqueries.
 */
export function predicateSpecs(
  body: Node,
  param: string | undefined,
  source: string,
  relations: RelationsMeta | undefined,
): IncludeSpec[] {
  if (!param || !relations) return [];
  const specs: IncludeSpec[] = [];

  const push = (
    chain: NavChain,
    extra: ReadonlyArray<{ readonly body: Node; readonly param: string | undefined }> = [],
  ): void => {
    const nested = [...chain.lambdas, ...extra].flatMap((l) =>
      predicateSpecs(l.body, l.param, chain.rel.target, relations),
    );
    specs.push({ nav: chain.nav, ...chain.rel, children: mergeIncludeSpecs(nested) });
  };

  const walk = (n: Node): void => {
    if (n.kind === "Call" && n.callee.kind === "Member") {
      const method = n.callee.prop;
      const lambda = n.args[0];
      if ((method === "some" || method === "every") && lambda?.kind === "Lambda") {
        const chain = matchNavChain(n.callee.object, param, source, relations);
        if (chain) {
          push(chain, [{ body: lambda.body, param: lambda.params[0] }]);
          for (const arg of n.args.slice(1)) walk(arg);
          return;
        }
      }
      if (method === "reduce" && lambda?.kind === "Lambda") {
        const chain = matchNavChain(n.callee.object, param, source, relations);
        if (chain) {
          // The element is the lambda's SECOND parameter: (acc, o) => …
          push(chain, [{ body: lambda.body, param: lambda.params[1] }]);
          for (const arg of n.args.slice(1)) walk(arg);
          return;
        }
      }
    }
    const chain = matchNavChain(n, param, source, relations);
    if (chain) {
      push(chain);
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
