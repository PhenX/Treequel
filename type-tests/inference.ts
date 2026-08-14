// Compile-time inference guarantees for the public API, checked by `tsc --noEmit`
// against the built .d.ts. A regression here is a broken build, not a test run.

import {
  type Grouping,
  type Ordered,
  type Queryable,
  type QueryProvider,
  createContext,
  expr,
} from "@treequel/linq";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
}
interface Order {
  id: number;
  userId: number;
  total: number;
}

declare const provider: QueryProvider;
declare const q: Queryable<User>;

// createContext maps each schema key to a Queryable of that row type.
const db = createContext<{ users: User; orders: Order }>(provider);
type _ctxUsers = Expect<Equal<typeof db.users, Queryable<User>>>;
type _ctxOrders = Expect<Equal<typeof db.orders, Queryable<Order>>>;

// where: the lambda parameter is inferred through the `Pred<T>` union, no annotation.
q.where((u) => {
  type _p = Expect<Equal<typeof u, User>>;
  return u.age > 1;
});

// select: return type is inferred, including object-literal widening.
const projected = db.users.select((u) => ({ id: u.id, upper: u.name }));
type _sel = Expect<Equal<typeof projected, Queryable<{ id: number; upper: string }>>>;

// select to a scalar.
const ages = db.users.select((u) => u.age);
type _scalar = Expect<Equal<typeof ages, Queryable<number>>>;

// Executors, with strictNullChecks-sensitive nullability.
type _toArray = Expect<Equal<Awaited<ReturnType<typeof q.toArray>>, User[]>>;
type _first = Expect<Equal<Awaited<ReturnType<typeof q.first>>, User>>;
type _firstOrNull = Expect<Equal<Awaited<ReturnType<typeof q.firstOrNull>>, User | null>>;
type _count = Expect<Equal<Awaited<ReturnType<typeof q.count>>, number>>;
type _any = Expect<Equal<Awaited<ReturnType<typeof q.any>>, boolean>>;
type _sum = Expect<Equal<Awaited<ReturnType<typeof q.sum>>, number>>;
type _min = Expect<Equal<Awaited<ReturnType<typeof q.min>>, number | null>>;

// orderBy returns Ordered<T>, which adds thenBy / thenByDescending.
const ordered = db.users.orderBy((u) => u.age);
type _ordered = Expect<Equal<typeof ordered, Ordered<User>>>;
ordered.thenByDescending((u) => u.name);

// groupBy yields a Queryable of groupings.
const grouped = db.users.groupBy((u) => u.active);
type _grouped = Expect<Equal<typeof grouped, Queryable<Grouping<boolean, User>>>>;

// Union acceptance: a plain function AND an Expr are both accepted where a
// predicate/projection is expected.
const fnPred = (u: User) => u.age > 1;
const exprPred = expr((u: User) => u.age > 1);
q.where(fnPred);
q.where(exprPred);
q.select(exprPred);

// The phantom brand does not leak into a projected row's keys.
type _noBrandLeak = Expect<
  Equal<keyof (typeof projected extends Queryable<infer R> ? R : never), "id" | "upper">
>;
