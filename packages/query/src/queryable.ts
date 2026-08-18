import { type Expr, GreffonError, expr, isExpr } from "@greffon/core";
import { type ComputedMeta, expandComputed } from "./computed.js";
import { appendChild, chainTail, navName, resolveRelation } from "./include-spec.js";
import { type Grouping, applyOps } from "./memory-engine.js";
import {
  type AnyExpr,
  type ExecKind,
  type IncludeSpec,
  type PlanOp,
  type QueryPlan,
  elementSource,
  withOp,
} from "./plan.js";
import type { QueryProvider } from "./provider.js";
import type { RelationsMeta, SchemaRelations } from "./relations.js";

/**
 * Predicates may return `undefined` (treated as false) so navigation tests
 * read like ordinary JS: `u => u.orders?.some(o => o.total > 10)`.
 */
export type Pred<T> = ((t: T) => boolean | undefined) | Expr<(t: T) => boolean | undefined>;
export type Proj<T, R> = ((t: T) => R) | Expr<(t: T) => R>;
export type Key<T, K> = ((t: T) => K) | Expr<(t: T) => K>;
export type Result2<T, U, R> = ((t: T, u: U) => R) | Expr<(t: T, u: U) => R>;
export type NavSelector<T, R> = ((t: T) => R) | Expr<(t: T) => R>;

/** The element type behind a navigation value: `Order[] | undefined` → `Order`. */
export type NavElement<R> = NonNullable<R> extends readonly (infer E)[] ? E : NonNullable<R>;

/** Keys of `T` whose value type is exactly `R` — recovers the navigation name. */
export type KeysWithValue<T, R> = keyof {
  [P in keyof T as [R] extends [T[P]] ? ([T[P]] extends [R] ? P : never) : never]: 0;
};

/**
 * Refinement of an include's loaded rows: filter, order, and slice them
 * per parent (`take`/`skip` require an order, so results are deterministic).
 */
export interface IncludeQuery<T> {
  filter(p: Pred<T>): IncludeQuery<T>;
  orderBy<K>(k: Key<T, K>): IncludeQuery<T>;
  orderByDescending<K>(k: Key<T, K>): IncludeQuery<T>;
  thenBy<K>(k: Key<T, K>): IncludeQuery<T>;
  thenByDescending<K>(k: Key<T, K>): IncludeQuery<T>;
  take(n: number): IncludeQuery<T>;
  skip(n: number): IncludeQuery<T>;
}

export type IncludeRefine<T> = (q: IncludeQuery<T>) => IncludeQuery<T>;

interface IncludeRefinement {
  readonly ops: readonly PlanOp[];
  readonly take?: number;
  readonly skip?: number;
}

class IncludeQueryBuilder<T> implements IncludeQuery<T> {
  constructor(
    readonly ops: readonly PlanOp[] = [],
    readonly takeN: number | undefined = undefined,
    readonly skipN: number | undefined = undefined,
  ) {}

  private op(op: PlanOp): IncludeQueryBuilder<T> {
    if (this.takeN !== undefined || this.skipN !== undefined) {
      throw new GreffonError("R2008", "Refine an include before slicing it with take()/skip().");
    }
    return new IncludeQueryBuilder<T>([...this.ops, op], this.takeN, this.skipN);
  }

  filter(p: Pred<T>): IncludeQuery<T> {
    return this.op({ op: "filter", expr: toExpr(p) });
  }
  orderBy<K>(k: Key<T, K>): IncludeQuery<T> {
    return this.op({ op: "orderBy", expr: toExpr(k), desc: false });
  }
  orderByDescending<K>(k: Key<T, K>): IncludeQuery<T> {
    return this.op({ op: "orderBy", expr: toExpr(k), desc: true });
  }
  thenBy<K>(k: Key<T, K>): IncludeQuery<T> {
    return this.op({ op: "thenBy", expr: toExpr(k), desc: false });
  }
  thenByDescending<K>(k: Key<T, K>): IncludeQuery<T> {
    return this.op({ op: "thenBy", expr: toExpr(k), desc: true });
  }
  take(n: number): IncludeQuery<T> {
    const m = Math.max(0, n);
    const cur = this.takeN;
    const next = cur === undefined ? m : Math.min(cur, m);
    return new IncludeQueryBuilder<T>(this.ops, next, this.skipN);
  }
  skip(n: number): IncludeQuery<T> {
    const m = Math.max(0, n);
    const nextTake = this.takeN === undefined ? undefined : Math.max(0, this.takeN - m);
    return new IncludeQueryBuilder<T>(this.ops, nextTake, (this.skipN ?? 0) + m);
  }

  finish(): IncludeRefinement | undefined {
    if (this.ops.length === 0 && this.takeN === undefined && this.skipN === undefined) {
      return undefined;
    }
    if (
      (this.takeN !== undefined || this.skipN !== undefined) &&
      !this.ops.some((o) => o.op === "orderBy")
    ) {
      throw new GreffonError(
        "R2008",
        "take()/skip() on an include requires an orderBy — per-parent slices must be deterministic.",
      );
    }
    return {
      ops: this.ops,
      ...(this.takeN !== undefined ? { take: this.takeN } : {}),
      ...(this.skipN !== undefined ? { skip: this.skipN } : {}),
    };
  }
}

function refineSpec(spec: IncludeSpec, refine: IncludeRefine<never> | undefined): IncludeSpec {
  if (!refine) return spec;
  const built = refine(new IncludeQueryBuilder<never>());
  if (!(built instanceof IncludeQueryBuilder)) {
    throw new GreffonError("R2008", "An include refinement must return the builder it was given.");
  }
  const refinement = built.finish();
  return refinement ? { ...spec, ...refinement } : spec;
}

/** `T` with the navigation properties `K` marked loaded (required, non-null). */
export type Loaded<T, K> = T & { [P in K & keyof T]-?: NonNullable<T[P]> };

export interface Queryable<T> {
  /** Keep the rows a predicate accepts — `Array.prototype.filter` for queries (LINQ `Where`). */
  filter(p: Pred<T>): Queryable<T>;
  /** Project each row through a selector — `Array.prototype.map` for queries (LINQ `Select`). */
  map<R>(s: Proj<T, R>): Queryable<R>;
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
  /**
   * Left outer join: every outer row survives; `result` receives `null` for the
   * inner side when there is no match, so projections must be null-safe
   * (`o?.total ?? 0`) — which is also exactly what SQL's NULL propagation does.
   */
  leftJoin<U, K, R>(
    inner: Queryable<U>,
    outerKey: Key<T, K>,
    innerKey: Key<U, K>,
    result: Result2<T, U | null, R>,
  ): Queryable<R>;
  /**
   * Load a declared navigation with the query (`db.users.include(u => u.orders)`).
   * Related rows attach to the final result rows; chain `.thenInclude()` for
   * nested navigations. Requires a relations map on the context. The optional
   * `refine` filters, orders and slices the loaded rows per parent:
   * `include(u => u.orders, q => q.orderByDescending(o => o.total).take(3))`.
   */
  include<R>(
    nav: NavSelector<T, R>,
    refine?: IncludeRefine<NavElement<R>>,
  ): Includable<Loaded<T, KeysWithValue<T, R>>, NavElement<R>>;
  /**
   * Expand each row through a declared navigation — `Array.prototype.flatMap`
   * for queries (EF `SelectMany`). Without a result selector the elements
   * become the related rows (and their own navigations stay usable); with one,
   * `result(parent, child)` shapes each pair. Rows whose key is null expand to
   * nothing.
   */
  flatMap<R, S = NavElement<R>>(
    nav: NavSelector<T, R>,
    result?: Result2<T, NavElement<R>, S>,
  ): Queryable<S>;
  /** Explicit client-eval boundary: rows cross here; the suffix runs in memory. */
  inMemory(): Queryable<T>;

  toArray(): Promise<T[]>;
  /** The first matching row, or `null` — never throws on an empty result. */
  first(p?: Pred<T>): Promise<T | null>;
  /** The first matching row; throws when there is none. */
  firstOrThrow(p?: Pred<T>): Promise<T>;
  /** Exactly one matching row; throws on zero or more than one. */
  single(p?: Pred<T>): Promise<T>;
  count(p?: Pred<T>): Promise<number>;
  /** True when any row matches — `Array.prototype.some` for queries. */
  some(p?: Pred<T>): Promise<boolean>;
  /** True when every row matches — `Array.prototype.every` for queries. */
  every(p: Pred<T>): Promise<boolean>;
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

/** A `Queryable` whose last operator was `include`; adds `thenInclude`. */
export interface Includable<T, TNav> extends Queryable<T> {
  thenInclude<R>(
    nav: NavSelector<TNav, R>,
    refine?: IncludeRefine<NavElement<R>>,
  ): Includable<T, NavElement<R>>;
}

function toExpr(fn: unknown): AnyExpr {
  return (isExpr(fn) ? fn : expr(fn as (...a: never[]) => unknown)) as AnyExpr;
}

/** Fail fast (before any I/O) if the provider can't honor a plan op. */
function precheck(provider: QueryProvider, plan: QueryPlan): void {
  const caps = provider.capabilities();
  for (const op of plan.ops) {
    if (!caps.ops.has(op.op)) {
      throw new GreffonError(
        "R2001",
        `Provider '${provider.name}' cannot translate the '${op.op}' operation.`,
      );
    }
    if (op.op === "join" || op.op === "leftJoin") precheck(provider, op.inner);
  }
}

const throwingSource = (source: string): never => {
  throw new GreffonError(
    "R2001",
    `In-memory suffix after .inMemory() cannot resolve source '${source}' (joins and includes after the boundary are unsupported in v1).`,
  );
};

class QueryableImpl<T> implements Ordered<T> {
  constructor(
    readonly provider: QueryProvider,
    readonly plan: QueryPlan,
    readonly relations?: RelationsMeta,
    readonly computed?: ComputedMeta,
  ) {}

  private next<R>(op: PlanOp): QueryableImpl<R> {
    return new QueryableImpl<R>(
      this.provider,
      withOp(this.plan, op),
      this.relations,
      this.computed,
    );
  }

  /** Inline any computed members before a provider ever sees the plan. */
  private expanded(plan: QueryPlan): QueryPlan {
    return this.computed ? expandComputed(plan, this.computed) : plan;
  }

  filter(p: Pred<T>): Queryable<T> {
    return this.next<T>({ op: "filter", expr: toExpr(p) });
  }
  map<R>(s: Proj<T, R>): Queryable<R> {
    return this.next<R>({ op: "map", expr: toExpr(s) });
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
    return this.joinOp<R>("join", (inner as QueryableImpl<U>).plan, outerKey, innerKey, result);
  }
  leftJoin<U, K, R>(
    inner: Queryable<U>,
    outerKey: Key<T, K>,
    innerKey: Key<U, K>,
    result: Result2<T, U | null, R>,
  ): Queryable<R> {
    return this.joinOp<R>("leftJoin", (inner as QueryableImpl<U>).plan, outerKey, innerKey, result);
  }
  private joinOp<R>(
    op: "join" | "leftJoin",
    inner: QueryPlan,
    outerKey: unknown,
    innerKey: unknown,
    result: unknown,
  ): Queryable<R> {
    return this.next<R>({
      op,
      inner,
      outerKey: toExpr(outerKey),
      innerKey: toExpr(innerKey),
      result: toExpr(result),
    });
  }
  /** Where build-time navigation resolution happens (follows flatMap). */
  private navSource(): string {
    return elementSource(this.plan) ?? this.plan.source;
  }
  include<R>(
    nav: NavSelector<T, R>,
    refine?: IncludeRefine<NavElement<R>>,
  ): Includable<Loaded<T, KeysWithValue<T, R>>, NavElement<R>> {
    const name = navName(nav);
    const rel = resolveRelation(this.relations, this.navSource(), name);
    const spec = refineSpec({ nav: name, ...rel }, refine as IncludeRefine<never> | undefined);
    return this.next({ op: "include", spec }) as unknown as Includable<
      Loaded<T, KeysWithValue<T, R>>,
      NavElement<R>
    >;
  }
  flatMap<R, S = NavElement<R>>(
    nav: NavSelector<T, R>,
    result?: Result2<T, NavElement<R>, S>,
  ): Queryable<S> {
    const name = navName(nav);
    const rel = resolveRelation(this.relations, this.navSource(), name);
    return this.next<S>({
      op: "flatMap",
      nav: name,
      target: rel.target,
      from: rel.from,
      to: rel.to,
      ...(result ? { result: toExpr(result) } : {}),
    });
  }
  thenInclude(
    nav: NavSelector<unknown, unknown>,
    refine?: IncludeRefine<never>,
  ): Includable<T, unknown> {
    const last = this.plan.ops[this.plan.ops.length - 1];
    if (!last || last.op !== "include") {
      throw new GreffonError("R2008", ".thenInclude() must directly follow .include().");
    }
    const name = navName(nav);
    const parent = chainTail(last.spec);
    const rel = resolveRelation(this.relations, parent.target, name);
    const spec = appendChild(last.spec, refineSpec({ nav: name, ...rel }, refine));
    const plan: QueryPlan = {
      ...this.plan,
      ops: [...this.plan.ops.slice(0, -1), { op: "include", spec }],
    };
    return new QueryableImpl(
      this.provider,
      plan,
      this.relations,
      this.computed,
    ) as unknown as Includable<T, unknown>;
  }
  inMemory(): Queryable<T> {
    return this.next<T>({ op: "inMemory" });
  }

  private async run<R>(kind: ExecKind, execExpr?: AnyExpr, orNull?: boolean): Promise<R> {
    const exec: PlanOp = {
      op: "exec",
      kind,
      ...(execExpr ? { expr: execExpr } : {}),
      ...(orNull ? { orNull } : {}),
    };
    const full = this.expanded(withOp(this.plan, exec));
    const boundary = full.ops.findIndex((o) => o.op === "inMemory");
    if (boundary === -1) {
      precheck(this.provider, full);
      return this.provider.execute<R>(full);
    }
    // Split at the boundary: provider runs the prefix, memory runs the suffix.
    const prefixPlan: QueryPlan = {
      ...full,
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
  first(p?: Pred<T>): Promise<T | null> {
    return this.run<T | null>("first", p ? toExpr(p) : undefined, true);
  }
  firstOrThrow(p?: Pred<T>): Promise<T> {
    return this.run<T>("first", p ? toExpr(p) : undefined);
  }
  single(p?: Pred<T>): Promise<T> {
    return this.run<T>("single", p ? toExpr(p) : undefined);
  }
  count(p?: Pred<T>): Promise<number> {
    return this.run<number>("count", p ? toExpr(p) : undefined);
  }
  some(p?: Pred<T>): Promise<boolean> {
    return this.run<boolean>("some", p ? toExpr(p) : undefined);
  }
  every(p: Pred<T>): Promise<boolean> {
    return this.run<boolean>("every", toExpr(p));
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
    const plan = this.expanded(this.plan);
    if (this.provider.explain) return this.provider.explain(plan);
    return `${this.provider.name}: ${plan.source} (${plan.ops.map((o) => o.op).join(" → ") || "scan"})`;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (const row of await this.toArray()) yield row;
  }
}

export interface ContextOptions<Schema> {
  /** Navigation metadata consumed by `include()` (see {@link defineRelations}). */
  readonly relations?: SchemaRelations<Schema>;
  /** Computed members inlined into queries (see {@link defineComputed}). */
  readonly computed?: ComputedMeta;
}

/** Construct a `Queryable` rooted at a provider + source name. */
export function queryable<T>(
  provider: QueryProvider,
  source: string,
  relations?: RelationsMeta,
  computed?: ComputedMeta,
): Queryable<T> {
  const plan: QueryPlan = { source, ops: [], ...(relations ? { relations } : {}) };
  return new QueryableImpl<T>(provider, plan, relations, computed);
}

export type Context<S> = { readonly [K in keyof S]: Queryable<S[K]> };

/**
 * The traced root. `db.users` becomes a `Queryable<User>` over the provider.
 * A Proxy maps each property access to a fresh (immutable) Queryable.
 */
export function createContext<Schema>(
  provider: QueryProvider,
  options: ContextOptions<Schema> = {},
): Context<Schema> {
  const relations = options.relations as RelationsMeta | undefined;
  const computed = options.computed;
  return new Proxy(Object.create(null) as Context<Schema>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return queryable(provider, prop, relations, computed);
    },
  });
}
