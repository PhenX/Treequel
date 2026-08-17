/**
 * `@treequel/query/testing` — the provider-author kit. `runConformance` runs a
 * battery of queries against a provider and the in-memory reference and reports any
 * divergence. The corpus lambdas are wrapped in `expr()` so providers under test
 * receive real `Expr` trees whenever this module runs under the build plugin
 * (trace `@treequel/core` in the plugin's `packages`) — or, without a build
 * step, under `import "@treequel/fallback/register"`.
 */
import { b, expr, makeExpr } from "@treequel/core";
import { canonical } from "./canon.js";
import { type ComputedMeta, defineComputed } from "./computed.js";
import { type Capabilities, capabilities } from "./provider.js";
import { runPlanInMemory } from "./memory-engine.js";
import { PLAN_OP_KINDS } from "./plan.js";
import type { QueryPlan } from "./plan.js";
import type { QueryProvider } from "./provider.js";
import { type RelationsMeta, type SchemaRelations, defineRelations } from "./relations.js";
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
 * The row types the standard corpus and fixtures are written against. Provider
 * test suites import these instead of redeclaring them.
 */
export interface SampleUser {
  id: number;
  name: string;
  age: number;
  active: boolean;
  city: string | null;
  orders?: SampleOrder[];
}
export interface SampleOrder {
  id: number;
  userId: number | null;
  total: number;
  user?: SampleUser | null;
  items?: SampleItem[];
}
export interface SampleItem {
  id: number;
  orderId: number;
  sku: string;
}
export interface SampleSchema {
  users: SampleUser;
  orders: SampleOrder;
  items: SampleItem;
}

/** The canonical fixture rows (`users` → `orders` → `items`) the corpus runs on. */
export const sampleUsers: SampleUser[] = [
  { id: 1, name: "Ada", age: 36, active: true, city: "London" },
  { id: 2, name: "Alan", age: 41, active: false, city: "London" },
  { id: 3, name: "Grace", age: 45, active: true, city: null },
  { id: 4, name: "Bob", age: 17, active: true, city: "NYC" },
  { id: 5, name: "50%off", age: 25, active: true, city: "Paris" },
  { id: 6, name: "a_b", age: 30, active: false, city: "Paris" },
];
export const sampleOrders: SampleOrder[] = [
  { id: 1, userId: 1, total: 10.5 },
  { id: 2, userId: 1, total: 20 },
  { id: 3, userId: 3, total: 5 },
  { id: 4, userId: null, total: 7 },
];
export const sampleItems: SampleItem[] = [
  { id: 1, orderId: 1, sku: "apple" },
  { id: 2, orderId: 1, sku: "pear" },
  { id: 3, orderId: 3, sku: "plum" },
];

/** The fixtures as a {@link Fixtures} map, ready to hand to `runConformance`. */
export function defaultFixtures(): Fixtures {
  return { users: sampleUsers, orders: sampleOrders, items: sampleItems };
}

/**
 * Relations matching the standard corpus fixtures (`users` → `orders` →
 * `items`). Pass to `createContext`/`runConformance` (and mirror in provider
 * schemas) when running the default cases.
 */
export const sampleRelations: SchemaRelations<SampleSchema> = defineRelations<SampleSchema>({
  users: {
    orders: { kind: "many", target: "orders", from: "id", to: "userId" },
  },
  orders: {
    user: { kind: "one", target: "users", from: "userId", to: "id" },
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
});

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
 * Computed members over the sample schema, exercised by {@link computedCases}.
 * Authored with `makeExpr` + the `b` builders so they carry real trees with no
 * build step: `isAdult`/`isSenior`/`decade`/`label` are properties (one param),
 * `net` a method (an extra arg). `isSenior` composes on `isAdult`. Every body is
 * a plain column expression, so each provider translates the inlined tree.
 */
export const sampleComputed: ComputedMeta = defineComputed<SampleSchema>({
  users: {
    isAdult: makeExpr(["u"], b.binary(">=", b.member(b.param("u"), "age"), b.const(18))),
    isSenior: makeExpr(
      ["u"],
      b.logical(
        "&&",
        b.member(b.param("u"), "isAdult"),
        b.binary(">=", b.member(b.param("u"), "age"), b.const(40)),
      ),
    ),
    decade: makeExpr(
      ["u"],
      b.binary(
        "-",
        b.member(b.param("u"), "age"),
        b.binary("%", b.member(b.param("u"), "age"), b.const(10)),
      ),
    ),
    label: makeExpr(
      ["u"],
      b.template(["", " (", ")"], [b.member(b.param("u"), "name"), b.member(b.param("u"), "age")]),
    ),
  },
  orders: {
    net: makeExpr(
      ["o", "rate"],
      b.binary("*", b.member(b.param("o"), "total"), b.binary("-", b.const(1), b.param("rate"))),
    ),
  },
});

/** Canonical, order-independent comparison key for an array of result rows. */
export function multiset(rows: readonly unknown[]): string[] {
  return rows.map((r) => canonical(r)).sort();
}

/**
 * The standard behavioral corpus. Every lambda is wrapped in `expr()` so the
 * build plugin reifies it regardless of how the surrounding harness passes the
 * context around.
 */
export function defaultCases(): ConformanceCase[] {
  type U = SampleUser;
  type O = SampleOrder;
  type I = SampleItem;
  const users = (db: Context<Record<string, unknown>>) => db.users as unknown as Queryable<U>;
  const orders = (db: Context<Record<string, unknown>>) => db.orders as unknown as Queryable<O>;
  const items = (db: Context<Record<string, unknown>>) => db.items as unknown as Queryable<I>;

  return [
    {
      name: "filter numeric",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.age >= 18))
          .toArray(),
    },
    {
      name: "filter + map projection",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.active))
          .map(expr((u: U) => ({ id: u.id, name: u.name })))
          .toArray(),
    },
    {
      name: "filter startsWith",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.name.startsWith("A")))
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
      name: "map distinct city",
      run: (db) =>
        users(db)
          .map(expr((u: U) => u.city))
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
      name: "filter after map projection",
      run: (db) =>
        users(db)
          .map(expr((u: U) => ({ id: u.id, years: u.age })))
          .filter(expr((r: { id: number; years: number }) => r.years > 30))
          .toArray(),
    },
    {
      name: "filter after scalar map",
      run: (db) =>
        users(db)
          .map(expr((u: U) => u.age))
          .filter(expr((a: number) => a > 30))
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
            orders(db).filter(expr((o: O) => o.total >= 10)),
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
      name: "join then filter over the joined shape",
      run: (db) =>
        orders(db)
          .join(
            users(db),
            expr((o: O) => o.userId),
            expr((u: U) => u.id),
            expr((o: O, u: U) => ({ order: o.id, who: u.name, total: o.total })),
          )
          .filter(expr((r: { order: number; who: string; total: number }) => r.total >= 10))
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
      name: "include composes with filter and take",
      ordered: true,
      run: (db) =>
        users(db)
          .include((u) => u.orders)
          .filter(expr((u: U) => u.active))
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
            users(db).map(expr((u: U) => ({ uid: u.id, label: u.name }))),
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
          .filter(expr((r: { order: number; total: number }) => r.total > 9999))
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
          .map(expr((u: U) => u.city))
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
          .map(expr((u: U) => ({ id: u.id })))
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
          .filter(expr((u: U) => u.orders?.some((o) => o.total >= 10)))
          .toArray(),
    },
    {
      name: "every over a navigation is vacuously true without children",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.orders?.every((o) => o.total >= 10)))
          .toArray(),
    },
    {
      name: "negated navigation some",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => !u.orders?.some((o) => o.total > 0)))
          .toArray(),
    },
    {
      name: "navigation some combined with a column predicate",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.active && u.orders?.some((o) => o.total > 5)))
          .toArray(),
    },
    {
      name: "navigation some nests two levels",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.orders?.some((o) => o.items?.some((i) => i.sku === "apple"))))
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
          .map(expr((u: U) => ({ name: u.name, orderCount: u.orders?.length ?? 0 })))
          .toArray(),
    },
    {
      name: "projection counts a filtered navigation",
      run: (db) =>
        users(db)
          .map(
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
          .map(
            expr((u: U) => ({
              name: u.name,
              spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0,
            })),
          )
          .toArray(),
    },
    {
      name: "filter compares a navigation count",
      run: (db) =>
        users(db)
          .filter(expr((u: U) => (u.orders?.length ?? 0) > 1))
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
        // A captured array whose `.includes` is what this case translates to SQL.
        // oxlint-disable-next-line unicorn/prefer-set-has
        const cities: Array<string | null> = ["London", "NYC"];
        return users(db)
          .filter(expr((u: U) => cities.includes(u.city)))
          .toArray();
      },
    },
    {
      name: "group and count per key",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .map(
            expr((g: { key: number | null; items: readonly O[] }) => ({
              userId: g.key,
              n: g.items.length,
            })),
          )
          .toArray(),
    },
    {
      name: "group by a composite key",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => ({ uid: o.userId })))
          .map(
            expr((g: { key: { uid: number | null }; items: readonly O[] }) => ({
              uid: g.key.uid,
              n: g.items.length,
            })),
          )
          .toArray(),
    },
    {
      name: "group aggregates: sum, min, max, average",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .map(
            expr((g: { key: number | null; items: readonly O[] }) => ({
              userId: g.key,
              total: g.items.reduce((acc, o) => acc + o.total, 0),
              low: g.items.reduce((m, o) => Math.min(m, o.total), Infinity),
              high: g.items.reduce((m, o) => Math.max(m, o.total), -Infinity),
              avg: g.items.reduce((acc, o) => acc + o.total, 0) / g.items.length,
            })),
          )
          .toArray(),
    },
    {
      name: "filtered count per group",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .map(
            expr((g: { key: number | null; items: readonly O[] }) => ({
              userId: g.key,
              big: g.items.filter((o) => o.total >= 10).length,
            })),
          )
          .toArray(),
    },
    {
      name: "having via filter over the group projection",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .map(
            expr((g: { key: number | null; items: readonly O[] }) => ({
              userId: g.key,
              n: g.items.length,
            })),
          )
          .filter(expr((r: { userId: number | null; n: number }) => r.n > 1))
          .toArray(),
    },
    {
      name: "group projection ordered and sliced",
      ordered: true,
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .map(
            expr((g: { key: number | null; items: readonly O[] }) => ({
              userId: g.key,
              total: g.items.reduce((acc, o) => acc + o.total, 0),
            })),
          )
          .orderByDescending(expr((r: { userId: number | null; total: number }) => r.total))
          .take(2)
          .toArray(),
    },
    {
      name: "count of groups",
      run: (db) =>
        orders(db)
          .groupBy(expr((o: O) => o.userId))
          .count(),
    },
    {
      name: "group by a navigation count",
      run: (db) =>
        users(db)
          .groupBy(expr((u: U) => u.orders?.length ?? 0))
          .map(
            expr((g: { key: number; items: readonly U[] }) => ({
              orders: g.key,
              people: g.items.length,
            })),
          )
          .toArray(),
    },
    {
      name: "filtered include",
      run: (db) =>
        users(db)
          .include(
            (u) => u.orders,
            (q) => q.filter(expr((o: O) => o.total >= 10)),
          )
          .toArray(),
    },
    {
      name: "ordered include",
      run: (db) =>
        users(db)
          .include(
            (u) => u.orders,
            (q) => q.orderByDescending(expr((o: O) => o.total)),
          )
          .toArray(),
    },
    {
      name: "top-one-per-parent include",
      run: (db) =>
        users(db)
          .include(
            (u) => u.orders,
            (q) =>
              q
                .orderByDescending(expr((o: O) => o.total))
                .thenBy(expr((o: O) => o.id))
                .take(1),
          )
          .toArray(),
    },
    {
      name: "filtered include with a navigation predicate",
      run: (db) =>
        users(db)
          .include(
            (u) => u.orders,
            (q) => q.filter(expr((o: O) => o.items?.some((i) => i.sku === "apple"))),
          )
          .toArray(),
    },
    {
      name: "refined thenInclude",
      run: (db) =>
        users(db)
          .include((u) => u.orders)
          .thenInclude(
            (o) => o.items,
            (q) => q.filter(expr((i: I) => i.sku !== "pear")),
          )
          .toArray(),
    },
    {
      name: "flatMap yields the related rows",
      run: (db) =>
        users(db)
          .flatMap((u) => u.orders)
          .toArray(),
    },
    {
      name: "flatMap with a result selector",
      run: (db) =>
        users(db)
          .flatMap(
            (u) => u.orders,
            expr((u: U, o: O) => ({ who: u.name, total: o.total })),
          )
          .toArray(),
    },
    {
      name: "flatMap over a reference navigation skips null keys",
      run: (db) =>
        orders(db)
          .flatMap(
            (o) => o.user,
            expr((o: O, u: U) => ({ order: o.id, who: u.name })),
          )
          .toArray(),
    },
    {
      name: "flatMap chains through two navigations",
      run: (db) =>
        users(db)
          .flatMap((u) => u.orders)
          .flatMap((o) => o.items)
          .toArray(),
    },
    {
      name: "flatMap composes with filter, orderBy and take",
      ordered: true,
      run: (db) =>
        users(db)
          .filter(expr((u: U) => u.active))
          .flatMap((u) => u.orders)
          .orderByDescending(expr((o: O) => o.total))
          .thenBy(expr((o: O) => o.id))
          .take(2)
          .toArray(),
    },
    {
      name: "navigation predicate after a flatMap",
      run: (db) =>
        users(db)
          .flatMap((u) => u.orders)
          .filter(expr((o: O) => o.items?.some((i) => i.sku === "apple")))
          .toArray(),
    },
    {
      name: "include after a flatMap",
      run: (db) =>
        users(db)
          .flatMap((u) => u.orders)
          .include((o) => o.items)
          .toArray(),
    },
  ];
}

/**
 * Cases exercising computed members (see {@link sampleComputed}). Appended to
 * the default corpus, so every provider proves memory ≡ its own translation of
 * the inlined trees: computed properties in filter/map/orderBy/count, a computed
 * composed from another, and a computed method with an argument in filter/map/sum.
 */
export function computedCases(): ConformanceCase[] {
  type UC = SampleUser & {
    isAdult: boolean;
    isSenior: boolean;
    decade: number;
    label: string;
  };
  type OC = SampleOrder & { net(rate: number): number };
  const usersC = (db: Context<Record<string, unknown>>) => db.users as unknown as Queryable<UC>;
  const ordersC = (db: Context<Record<string, unknown>>) => db.orders as unknown as Queryable<OC>;

  return [
    {
      name: "computed property in a filter",
      run: (db) =>
        usersC(db)
          .filter(expr((u: UC) => u.isAdult))
          .toArray(),
    },
    {
      name: "computed property composed from another",
      run: (db) =>
        usersC(db)
          .filter(expr((u: UC) => u.isSenior))
          .toArray(),
    },
    {
      name: "computed property beside a real column",
      run: (db) =>
        usersC(db)
          .filter(expr((u: UC) => u.isAdult && u.active))
          .toArray(),
    },
    {
      name: "computed numeric in a projection",
      run: (db) =>
        usersC(db)
          .map(expr((u: UC) => ({ id: u.id, decade: u.decade })))
          .toArray(),
    },
    {
      name: "computed template in a projection",
      run: (db) =>
        usersC(db)
          .map(expr((u: UC) => ({ id: u.id, label: u.label })))
          .toArray(),
    },
    {
      name: "orderBy a computed key",
      ordered: true,
      run: (db) =>
        usersC(db)
          .orderBy(expr((u: UC) => u.decade))
          .thenBy(expr((u: UC) => u.id))
          .toArray(),
    },
    {
      name: "count with a computed predicate",
      run: (db) => usersC(db).count(expr((u: UC) => u.isAdult)),
    },
    {
      name: "computed method in a filter",
      run: (db) =>
        ordersC(db)
          .filter(expr((o: OC) => o.net(0.5) > 5))
          .toArray(),
    },
    {
      name: "computed method in a projection",
      run: (db) =>
        ordersC(db)
          .map(expr((o: OC) => ({ id: o.id, net: o.net(0.5) })))
          .toArray(),
    },
    {
      name: "aggregate over a computed method",
      run: (db) => ordersC(db).sum(expr((o: OC) => o.net(0))),
    },
  ];
}

/** Run the corpus against a provider and the reference; return per-case comparisons. */
export async function runConformance(
  makeProvider: (fixtures: Fixtures) => QueryProvider | Promise<QueryProvider>,
  opts: {
    fixtures: Fixtures;
    cases?: ConformanceCase[];
    relations?: RelationsMeta;
    computed?: ComputedMeta;
  },
): Promise<ConformanceResult[]> {
  const cases = opts.cases ?? [...defaultCases(), ...computedCases()];
  const computed = opts.computed ?? sampleComputed;
  const options = {
    relations: opts.relations,
    computed,
  } as ContextOptions<Record<string, unknown>>;
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
