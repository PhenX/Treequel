/**
 * `@treequel/linq/testing` — the provider-author kit. `runConformance` runs a
 * battery of queries against a provider and the in-memory reference and reports any
 * divergence. The corpus lambdas are wrapped in `expr()` so providers under test
 * receive real `Expr` trees whenever this module runs under the build plugin
 * (trace `@treequel/core` in the plugin's `packages`) — or, without a build
 * step, under `import "@treequel/fallback/register"`.
 */
import { expr } from "@treequel/core";
import { canonical } from "./canon.js";
import { type Capabilities, capabilities } from "./provider.js";
import { runPlanInMemory } from "./memory-engine.js";
import { PLAN_OP_KINDS } from "./plan.js";
import type { QueryPlan } from "./plan.js";
import type { QueryProvider } from "./provider.js";
import type { RelationsMeta } from "./relations.js";
import { type Context, type ContextOptions, type Queryable, createContext } from "./queryable.js";

export interface Fixtures {
  readonly [source: string]: readonly unknown[];
}

export interface ConformanceCase {
  readonly name: string;
  readonly run: (db: Context<Record<string, unknown>>) => Promise<unknown>;
  /** Compare results in order (default: as a multiset). */
  readonly ordered?: boolean;
}

export interface ConformanceResult {
  readonly name: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly equal: boolean;
  readonly error?: unknown;
}

function referenceProvider(fixtures: Fixtures): QueryProvider {
  return {
    name: "reference",
    capabilities(): Capabilities {
      return capabilities([...PLAN_OP_KINDS]);
    },
    async execute<T>(plan: QueryPlan): Promise<T> {
      return runPlanInMemory(plan, (s) => fixtures[s] ?? []) as T;
    },
  };
}

function equal(expected: unknown, actual: unknown, ordered: boolean): boolean {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false;
    if (ordered) return canonical(expected) === canonical(actual);
    const a = expected.map(canonical).sort();
    const b = actual.map(canonical).sort();
    return a.every((x, i) => x === b[i]);
  }
  return canonical(expected) === canonical(actual);
}

/**
 * Relations matching the standard corpus fixtures (`users` → `orders` →
 * `items`). Pass to `runConformance` (and mirror in provider schemas) when
 * running the default cases.
 */
export function defaultRelations(): RelationsMeta {
  return {
    users: {
      orders: { kind: "many", target: "orders", from: "id", to: "userId" },
    },
    orders: {
      user: { kind: "one", target: "users", from: "userId", to: "id" },
      items: { kind: "many", target: "items", from: "id", to: "orderId" },
    },
  };
}

/**
 * The standard behavioral corpus. Every lambda is wrapped in `expr()` so the
 * build plugin reifies it regardless of how the surrounding harness passes the
 * context around.
 */
export function defaultCases(): ConformanceCase[] {
  type U = {
    id: number;
    name: string;
    age: number;
    active: boolean;
    city: string | null;
    orders?: O[];
  };
  type O = { id: number; userId: number | null; total: number; user?: U | null; items?: I[] };
  type I = { id: number; orderId: number; sku: string };
  const users = (db: Context<Record<string, unknown>>) => db.users as unknown as Queryable<U>;
  const orders = (db: Context<Record<string, unknown>>) => db.orders as unknown as Queryable<O>;
  const items = (db: Context<Record<string, unknown>>) => db.items as unknown as Queryable<I>;

  return [
    {
      name: "where numeric",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.age >= 18))
          .toArray(),
    },
    {
      name: "where + select projection",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.active))
          .select(expr((u: U) => ({ id: u.id, name: u.name })))
          .toArray(),
    },
    {
      name: "where startsWith",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.name.startsWith("A")))
          .toArray(),
    },
    {
      name: "orderBy then take",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy(expr((u: U) => u.age))
          .take(3)
          .toArray(),
    },
    {
      name: "orderByDescending thenBy",
      ordered: true,
      run: (db) =>
        users(db)
          .orderByDescending(expr((u: U) => u.age))
          .thenBy(expr((u: U) => u.name))
          .toArray(),
    },
    {
      name: "skip",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy(expr((u: U) => u.id))
          .skip(2)
          .toArray(),
    },
    {
      name: "count with predicate",
      run: (db) => users(db).count(expr((u: U) => u.age > 30)),
    },
    { name: "some", run: (db) => users(db).some(expr((u: U) => u.age > 90)) },
    { name: "sum", run: (db) => orders(db).sum(expr((o: O) => o.total)) },
    {
      name: "select distinct city",
      run: (db) =>
        users(db)
          .select(expr((u: U) => u.city))
          .distinct()
          .toArray(),
    },
    {
      name: "take then skip composes as a slice",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy(expr((u: U) => u.id))
          .take(3)
          .skip(1)
          .toArray(),
    },
    {
      name: "where after select projection",
      run: (db) =>
        users(db)
          .select(expr((u: U) => ({ id: u.id, years: u.age })))
          .where(expr((r: { id: number; years: number }) => r.years > 30))
          .toArray(),
    },
    {
      name: "where after scalar select",
      run: (db) =>
        users(db)
          .select(expr((u: U) => u.age))
          .where(expr((a: number) => a > 30))
          .toArray(),
    },
    {
      name: "inner join with projection (null keys never match)",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U) => ({ order: o.id, who: u.name })),
          )
          .toArray(),
    },
    {
      name: "join with a filtered inner query",
      run: (db) =>
        users(db)
          .join(
            orders(db).where(expr((o: O) => o.total >= 10)),
            expr((u: U) => u.id),
            expr((o: O) => o.userId),
            expr((u: U, o: O) => ({ name: u.name, total: o.total })),
          )
          .toArray(),
    },
    {
      name: "left join keeps unmatched outer rows",
      run: (db) =>
        orders(db)
          .leftJoin(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U | null) => ({ order: o.id, who: u?.name ?? null })),
          )
          .toArray(),
    },
    {
      name: "join then where over the joined shape",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U) => ({ order: o.id, who: u.name, total: o.total })),
          )
          .where(expr((r: { order: number; who: string; total: number }) => r.total >= 10))
          .toArray(),
    },
    {
      name: "include a collection navigation",
      run: (db) =>
        users(db)
          .include((u) => u.orders)
          .toArray(),
    },
    {
      name: "include a reference navigation",
      run: (db) =>
        orders(db)
          .include((o) => o.user)
          .toArray(),
    },
    {
      name: "include with thenInclude",
      run: (db) =>
        users(db)
          .include((u) => u.orders)
          .thenInclude((o) => o.items)
          .toArray(),
    },
    {
      name: "include composes with where and take",
      ordered: true,
      run: (db) =>
        users(db)
          .include((u) => u.orders)
          .where(expr((u: U) => u.active))
          .orderBy(expr((u: U) => u.id))
          .take(2)
          .toArray(),
    },
    {
      name: "chained joins across three sources",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U) => ({ oid: o.id, who: u.name })),
          )
          .join(
            items(db),
            expr((r: { oid: number; who: string }) => r.oid),
            expr((i: I) => i.orderId),
            expr((r: { oid: number; who: string }, i: I) => ({ who: r.who, sku: i.sku })),
          )
          .toArray(),
    },
    {
      name: "self join pairs rows by a shared key",
      run: (db) =>
        users(db)
          .join(
            users(db),
            expr((u: U) => u.city),
            expr((v: U) => v.city),
            expr((u: U, v: U) => ({ a: u.id, b: v.id })),
          )
          .toArray(),
    },
    {
      name: "join with a projected inner query",
      run: (db) =>
        orders(db)
          .join(
            users(db).select(expr((u: U) => ({ uid: u.id, label: u.name }))),
            expr((o: O) => o.userId),
            expr((r: { uid: number; label: string }) => r.uid),
            expr((o: O, r: { uid: number; label: string }) => ({ order: o.id, label: r.label })),
          )
          .toArray(),
    },
    {
      name: "composite join keys with a null member never match",
      run: (db) =>
        orders(db)
          .leftJoin(
            users(db),
            expr((o: O) => ({ id: o.userId, tag: "x" })),
            expr((u: U) => ({ id: u.id, tag: "x" })),
            expr((o: O, u: U | null) => ({ order: o.id, who: u?.name ?? null })),
          )
          .toArray(),
    },
    {
      name: "left join feeds an aggregate with a null default",
      run: (db) =>
        orders(db)
          .leftJoin(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U | null) => ({ total: o.total, age: u?.age ?? 0 })),
          )
          .sum(expr((r: { total: number; age: number }) => r.age)),
    },
    {
      name: "some over a joined projection",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U) => ({ total: o.total, active: u.active })),
          )
          .some(expr((r: { total: number; active: boolean }) => r.total > 15)),
    },
    {
      name: "first over an empty joined result is null",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, _u: U) => ({ order: o.id, total: o.total })),
          )
          .where(expr((r: { order: number; total: number }) => r.total > 9999))
          .first(),
    },
    {
      name: "take zero yields no rows",
      ordered: true,
      run: (db) => users(db).take(0).toArray(),
    },
    {
      name: "skip beyond the row count yields no rows",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy(expr((u: U) => u.id))
          .skip(1000)
          .toArray(),
    },
    {
      name: "distinct then count",
      run: (db) =>
        users(db)
          .select(expr((u: U) => u.city))
          .distinct()
          .count(),
    },
    {
      name: "include a reference then its collection (cycle back)",
      run: (db) =>
        orders(db)
          .include((o) => o.user)
          .thenInclude((u) => u.orders)
          .toArray(),
    },
    {
      name: "include after a projection that keeps the key",
      run: (db) =>
        users(db)
          .select(expr((u: U) => ({ id: u.id })))
          .include((u) => (u as unknown as U).orders)
          .toArray(),
    },
    {
      name: "repeated include of one navigation merges its branches",
      run: (db) =>
        orders(db)
          .include((o) => o.items)
          .include((o) => o.user)
          .include((o) => o.items)
          .toArray(),
    },
    {
      name: "some over a navigation filters like EXISTS",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.orders?.some((o) => o.total >= 10)))
          .toArray(),
    },
    {
      name: "every over a navigation is vacuously true without children",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.orders?.every((o) => o.total >= 10)))
          .toArray(),
    },
    {
      name: "negated navigation some",
      run: (db) =>
        users(db)
          .where(expr((u: U) => !u.orders?.some((o) => o.total > 0)))
          .toArray(),
    },
    {
      name: "navigation some combined with a column predicate",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.active && u.orders?.some((o) => o.total > 5)))
          .toArray(),
    },
    {
      name: "navigation some nests two levels",
      run: (db) =>
        users(db)
          .where(expr((u: U) => u.orders?.some((o) => o.items?.some((i) => i.sku === "apple"))))
          .toArray(),
    },
    {
      name: "navigation some in an executor position",
      run: (db) => users(db).count(expr((u: U) => u.orders?.some((o) => o.total > 5))),
    },
    {
      name: "projection counts a navigation",
      run: (db) =>
        users(db)
          .select(expr((u: U) => ({ name: u.name, orderCount: u.orders?.length ?? 0 })))
          .toArray(),
    },
    {
      name: "projection counts a filtered navigation",
      run: (db) =>
        users(db)
          .select(
            expr((u: U) => ({
              id: u.id,
              big: u.orders?.filter((o) => o.total >= 10).length ?? 0,
            })),
          )
          .toArray(),
    },
    {
      name: "projection sums a navigation via the reduce idiom",
      run: (db) =>
        users(db)
          .select(
            expr((u: U) => ({
              name: u.name,
              spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0,
            })),
          )
          .toArray(),
    },
    {
      name: "where compares a navigation count",
      run: (db) =>
        users(db)
          .where(expr((u: U) => (u.orders?.length ?? 0) > 1))
          .toArray(),
    },
    {
      name: "orderBy a navigation count",
      ordered: true,
      run: (db) =>
        users(db)
          .orderByDescending(expr((u: U) => u.orders?.length ?? 0))
          .thenBy(expr((u: U) => u.id))
          .toArray(),
    },
    {
      name: "aggregate over a correlated sum",
      run: (db) =>
        users(db).sum(expr((u: U) => u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0)),
    },
    {
      name: "membership against a captured array",
      run: (db) => {
        const cities: Array<string | null> = ["London", "NYC"];
        return users(db)
          .where(expr((u: U) => cities.includes(u.city)))
          .toArray();
      },
    },
  ];
}

/** Run the corpus against a provider and the reference; return per-case comparisons. */
export async function runConformance(
  makeProvider: (fixtures: Fixtures) => QueryProvider | Promise<QueryProvider>,
  opts: { fixtures: Fixtures; cases?: ConformanceCase[]; relations?: RelationsMeta },
): Promise<ConformanceResult[]> {
  const cases = opts.cases ?? defaultCases();
  const options = { relations: opts.relations } as ContextOptions<Record<string, unknown>>;
  const referenceCtx = createContext<Record<string, unknown>>(
    referenceProvider(opts.fixtures),
    options,
  );
  const provider = await makeProvider(opts.fixtures);
  const providerCtx = createContext<Record<string, unknown>>(provider, options);

  const results: ConformanceResult[] = [];
  for (const c of cases) {
    const expected = await c.run(referenceCtx);
    try {
      const actual = await c.run(providerCtx);
      results.push({
        name: c.name,
        expected,
        actual,
        equal: equal(expected, actual, c.ordered ?? false),
      });
    } catch (error) {
      results.push({ name: c.name, expected, actual: undefined, equal: false, error });
    }
  }
  return results;
}
