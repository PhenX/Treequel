/**
 * `@treequel/linq/testing` — the provider-author kit. `runConformance` runs a
 * battery of queries against a provider and the in-memory oracle and reports any
 * divergence. Providers under test receive real `Expr`
 * trees when this suite runs under the build plugin (e.g. Vitest + @treequel/vite).
 */
import { type Capabilities, capabilities } from "./provider.js";
import { runPlanInMemory } from "./memory-engine.js";
import type { QueryPlan } from "./plan.js";
import type { QueryProvider } from "./provider.js";
import { type Context, createContext } from "./queryable.js";

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

const ALL_OPS = [
  "where",
  "select",
  "orderBy",
  "thenBy",
  "take",
  "skip",
  "distinct",
  "groupBy",
  "join",
  "inMemory",
  "exec",
];

function oracleProvider(fixtures: Fixtures): QueryProvider {
  return {
    name: "oracle",
    capabilities(): Capabilities {
      return capabilities(ALL_OPS);
    },
    async execute<T>(plan: QueryPlan): Promise<T> {
      return runPlanInMemory(plan, (s) => fixtures[s] ?? []) as T;
    },
  };
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => (a < b ? -1 : 1)))
      : (val as unknown),
  );
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

/** The standard behavioral corpus. Written as inline lambdas so the build plugin reifies them. */
export function defaultCases(): ConformanceCase[] {
  type U = { id: number; name: string; age: number; active: boolean; city: string | null };
  type O = { id: number; userId: number; total: number };
  const users = (db: Context<Record<string, unknown>>) =>
    db.users as unknown as import("./queryable.js").Queryable<U>;
  const orders = (db: Context<Record<string, unknown>>) =>
    db.orders as unknown as import("./queryable.js").Queryable<O>;

  return [
    {
      name: "where numeric",
      run: (db) =>
        users(db)
          .where((u) => u.age >= 18)
          .toArray(),
    },
    {
      name: "where + select projection",
      run: (db) =>
        users(db)
          .where((u) => u.active)
          .select((u) => ({ id: u.id, name: u.name }))
          .toArray(),
    },
    {
      name: "where startsWith",
      run: (db) =>
        users(db)
          .where((u) => u.name.startsWith("A"))
          .toArray(),
    },
    {
      name: "orderBy then take",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy((u) => u.age)
          .take(3)
          .toArray(),
    },
    {
      name: "orderByDescending thenBy",
      ordered: true,
      run: (db) =>
        users(db)
          .orderByDescending((u) => u.age)
          .thenBy((u) => u.name)
          .toArray(),
    },
    {
      name: "skip",
      ordered: true,
      run: (db) =>
        users(db)
          .orderBy((u) => u.id)
          .skip(2)
          .toArray(),
    },
    { name: "count with predicate", run: (db) => users(db).count((u) => u.age > 30) },
    { name: "any", run: (db) => users(db).any((u) => u.age > 90) },
    { name: "sum", run: (db) => orders(db).sum((o) => o.total) },
    {
      name: "select distinct city",
      run: (db) =>
        users(db)
          .select((u) => u.city)
          .distinct()
          .toArray(),
    },
  ];
}

/** Run the corpus against a provider and the oracle; return per-case comparisons. */
export async function runConformance(
  makeProvider: (fixtures: Fixtures) => QueryProvider | Promise<QueryProvider>,
  opts: { fixtures: Fixtures; cases?: ConformanceCase[] },
): Promise<ConformanceResult[]> {
  const cases = opts.cases ?? defaultCases();
  const oracleCtx = createContext(oracleProvider(opts.fixtures));
  const provider = await makeProvider(opts.fixtures);
  const providerCtx = createContext(provider);

  const results: ConformanceResult[] = [];
  for (const c of cases) {
    const expected = await c.run(oracleCtx);
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
