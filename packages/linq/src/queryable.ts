import { type Expr, TreequelError, expr, isExpr } from "@treequel/core";
import { type Grouping, applyOps } from "./memory-engine.js";
import { type AnyExpr, type ExecKind, type PlanOp, type QueryPlan, withOp } from "./plan.js";
import type { QueryProvider } from "./provider.js";

export type Pred<T> = ((t: T) => boolean) | Expr<(t: T) => boolean>;
export type Proj<T, R> = ((t: T) => R) | Expr<(t: T) => R>;
export type Key<T, K> = ((t: T) => K) | Expr<(t: T) => K>;
export type Result2<T, U, R> = ((t: T, u: U) => R) | Expr<(t: T, u: U) => R>;

export interface Queryable<T> {
  where(p: Pred<T>): Queryable<T>;
  select<R>(s: Proj<T, R>): Queryable<R>;
  orderBy<K>(k: Key<T, K>): Ordered<T>;
  orderByDescending<K>(k: Key<T, K>): Ordered<T>;
  distinct(): Queryable<T>;
  take(n: number): Queryable<T>;
  skip(n: number): Queryable<T>;
  groupBy<K>(k: Key<T, K>): Queryable<Grouping<K, T>>;
  join<U, K, R>(
    inner: Queryable<U>,
    outerKey: Key<T, K>,
    innerKey: Key<U, K>,
    result: Result2<T, U, R>,
  ): Queryable<R>;
  /** Explicit client-eval boundary: rows cross here; the suffix runs in memory. */
  inMemory(): Queryable<T>;

  toArray(): Promise<T[]>;
  first(p?: Pred<T>): Promise<T>;
  firstOrNull(p?: Pred<T>): Promise<T | null>;
  single(p?: Pred<T>): Promise<T>;
  count(p?: Pred<T>): Promise<number>;
  any(p?: Pred<T>): Promise<boolean>;
  all(p: Pred<T>): Promise<boolean>;
  sum(s: Key<T, number>): Promise<number>;
  min(s: Key<T, number>): Promise<number | null>;
  max(s: Key<T, number>): Promise<number | null>;
  avg(s: Key<T, number>): Promise<number | null>;

  explain(): Promise<string>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface Ordered<T> extends Queryable<T> {
  thenBy<K>(k: Key<T, K>): Ordered<T>;
  thenByDescending<K>(k: Key<T, K>): Ordered<T>;
}

function toExpr(fn: unknown): AnyExpr {
  return (isExpr(fn) ? fn : expr(fn as (...a: never[]) => unknown)) as AnyExpr;
}

/** Fail fast (before any I/O) if the provider can't honor a plan op. */
function precheck(provider: QueryProvider, plan: QueryPlan): void {
  const caps = provider.capabilities();
  for (const op of plan.ops) {
    if (!caps.ops.has(op.op)) {
      throw new TreequelError(
        "R2001",
        `Provider '${provider.name}' cannot translate the '${op.op}' operation.`,
      );
    }
  }
}

const throwingSource = (source: string): never => {
  throw new TreequelError(
    "R2001",
    `In-memory suffix after .inMemory() cannot resolve source '${source}' (joins after the boundary are unsupported in v1).`,
  );
};

class QueryableImpl<T> implements Ordered<T> {
  constructor(
    readonly provider: QueryProvider,
    readonly plan: QueryPlan,
  ) {}

  private next<R>(op: PlanOp): QueryableImpl<R> {
    return new QueryableImpl<R>(this.provider, withOp(this.plan, op));
  }

  where(p: Pred<T>): Queryable<T> {
    return this.next<T>({ op: "where", expr: toExpr(p) });
  }
  select<R>(s: Proj<T, R>): Queryable<R> {
    return this.next<R>({ op: "select", expr: toExpr(s) });
  }
  orderBy<K>(k: Key<T, K>): Ordered<T> {
    return this.next<T>({ op: "orderBy", expr: toExpr(k), desc: false });
  }
  orderByDescending<K>(k: Key<T, K>): Ordered<T> {
    return this.next<T>({ op: "orderBy", expr: toExpr(k), desc: true });
  }
  thenBy<K>(k: Key<T, K>): Ordered<T> {
    return this.next<T>({ op: "thenBy", expr: toExpr(k), desc: false });
  }
  thenByDescending<K>(k: Key<T, K>): Ordered<T> {
    return this.next<T>({ op: "thenBy", expr: toExpr(k), desc: true });
  }
  distinct(): Queryable<T> {
    return this.next<T>({ op: "distinct" });
  }
  take(n: number): Queryable<T> {
    return this.next<T>({ op: "take", n });
  }
  skip(n: number): Queryable<T> {
    return this.next<T>({ op: "skip", n });
  }
  groupBy<K>(k: Key<T, K>): Queryable<Grouping<K, T>> {
    return this.next<Grouping<K, T>>({ op: "groupBy", expr: toExpr(k) });
  }
  join<U, K, R>(
    inner: Queryable<U>,
    outerKey: Key<T, K>,
    innerKey: Key<U, K>,
    result: Result2<T, U, R>,
  ): Queryable<R> {
    return this.next<R>({
      op: "join",
      inner: (inner as QueryableImpl<U>).plan,
      outerKey: toExpr(outerKey),
      innerKey: toExpr(innerKey),
      result: toExpr(result),
    });
  }
  inMemory(): Queryable<T> {
    return this.next<T>({ op: "inMemory" });
  }

  private async run<R>(kind: ExecKind, expr?: AnyExpr, orNull?: boolean): Promise<R> {
    const exec: PlanOp = {
      op: "exec",
      kind,
      ...(expr ? { expr } : {}),
      ...(orNull ? { orNull } : {}),
    };
    const full = withOp(this.plan, exec);
    const boundary = full.ops.findIndex((o) => o.op === "inMemory");
    if (boundary === -1) {
      precheck(this.provider, full);
      return this.provider.execute<R>(full);
    }
    // Split at the boundary: provider runs the prefix, memory runs the suffix.
    const prefixPlan: QueryPlan = {
      source: full.source,
      ops: [...full.ops.slice(0, boundary), { op: "exec", kind: "toArray" }],
    };
    precheck(this.provider, prefixPlan);
    const rows = await this.provider.execute<unknown[]>(prefixPlan);
    const suffix = full.ops.slice(boundary + 1);
    return applyOps([...rows], suffix, throwingSource) as R;
  }

  toArray(): Promise<T[]> {
    return this.run<T[]>("toArray");
  }
  first(p?: Pred<T>): Promise<T> {
    return this.run<T>("first", p ? toExpr(p) : undefined);
  }
  firstOrNull(p?: Pred<T>): Promise<T | null> {
    return this.run<T | null>("first", p ? toExpr(p) : undefined, true);
  }
  single(p?: Pred<T>): Promise<T> {
    return this.run<T>("single", p ? toExpr(p) : undefined);
  }
  count(p?: Pred<T>): Promise<number> {
    return this.run<number>("count", p ? toExpr(p) : undefined);
  }
  any(p?: Pred<T>): Promise<boolean> {
    return this.run<boolean>("any", p ? toExpr(p) : undefined);
  }
  all(p: Pred<T>): Promise<boolean> {
    return this.run<boolean>("all", toExpr(p));
  }
  sum(s: Key<T, number>): Promise<number> {
    return this.run<number>("sum", toExpr(s));
  }
  min(s: Key<T, number>): Promise<number | null> {
    return this.run<number | null>("min", toExpr(s));
  }
  max(s: Key<T, number>): Promise<number | null> {
    return this.run<number | null>("max", toExpr(s));
  }
  avg(s: Key<T, number>): Promise<number | null> {
    return this.run<number | null>("avg", toExpr(s));
  }

  async explain(): Promise<string> {
    if (this.provider.explain) return this.provider.explain(this.plan);
    return `${this.provider.name}: ${this.plan.source} (${this.plan.ops.map((o) => o.op).join(" → ") || "scan"})`;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (const row of await this.toArray()) yield row;
  }
}

/** Construct a `Queryable` rooted at a provider + source name. */
export function queryable<T>(provider: QueryProvider, source: string): Queryable<T> {
  return new QueryableImpl<T>(provider, { source, ops: [] });
}

export type Context<S> = { readonly [K in keyof S]: Queryable<S[K]> };

/**
 * The traced root. `db.users` becomes a `Queryable<User>` over the provider.
 * A Proxy maps each property access to a fresh (immutable) Queryable.
 */
export function createContext<Schema>(provider: QueryProvider): Context<Schema> {
  return new Proxy(Object.create(null) as Context<Schema>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return queryable(provider, prop);
    },
  });
}
