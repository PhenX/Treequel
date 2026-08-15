// Compile-time inference guarantees for the public API, checked by `tsc --noEmit`
// against the built .d.ts. A regression here is a broken build, not a test run.

import {
  type Grouping,
  type Includable,
  type Loaded,
  type Ordered,
  type Queryable,
  type QueryProvider,
  createContext,
  defineRelations,
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
type _first = Expect<Equal<Awaited<ReturnType<typeof q.first>>, User | null>>;
type _firstOrThrow = Expect<Equal<Awaited<ReturnType<typeof q.firstOrThrow>>, User>>;
type _count = Expect<Equal<Awaited<ReturnType<typeof q.count>>, number>>;
type _some = Expect<Equal<Awaited<ReturnType<typeof q.some>>, boolean>>;
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

// --- joins & includes -------------------------------------------------------

interface NavItem {
  id: number;
  orderId: number;
  sku: string;
}
interface NavOrder {
  id: number;
  userId: number | null;
  total: number;
  user?: NavUser | null;
  items?: NavItem[];
}
interface NavUser {
  id: number;
  name: string;
  active: boolean;
  orders?: NavOrder[];
}
interface NavSchema {
  users: NavUser;
  orders: NavOrder;
  items: NavItem;
}

// defineRelations validates navigation names, targets and key properties.
const navRelations = defineRelations<NavSchema>({
  users: {
    orders: { kind: "many", target: "orders", from: "id", to: "userId" },
  },
  orders: {
    user: { kind: "one", target: "users", from: "userId", to: "id" },
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
});
const navDb = createContext<NavSchema>(provider, { relations: navRelations });

defineRelations<NavSchema>({
  users: {
    orders: {
      kind: "many",
      // @ts-expect-error — "bogus" is not a source in the schema.
      target: "bogus",
      from: "id",
      to: "userId",
    },
  },
});
defineRelations<NavSchema>({
  users: {
    orders: {
      kind: "many",
      target: "orders",
      from: "id",
      // @ts-expect-error — "sku" is not a key of the orders row.
      to: "sku",
    },
  },
});

// include() marks the navigation loaded (required, non-null) and carries the
// element type for thenInclude chaining.
const included = navDb.users.include((u) => u.orders);
type _inc = Expect<Equal<typeof included, Includable<Loaded<NavUser, "orders">, NavOrder>>>;
const nested = included.thenInclude((o) => o.items);
type _nested = Expect<Equal<typeof nested, Includable<Loaded<NavUser, "orders">, NavItem>>>;

// The loaded rows have the navigation present, not optional.
async function loadedRows(): Promise<void> {
  const rows = await included.toArray();
  type _loaded = Expect<Equal<(typeof rows)[0]["orders"], NavOrder[]>>;
}
void loadedRows;

// A reference navigation loads as its element type.
const withUser = navDb.orders.include((o) => o.user);
type _incOne = Expect<Equal<typeof withUser, Includable<Loaded<NavOrder, "user">, NavUser>>>;

// join: both key selectors and the two-parameter result infer.
const joined = navDb.orders.join(
  navDb.users,
  (o) => o.userId,
  (u) => u.id,
  (o, u) => ({ order: o.id, who: u.name }),
);
type _joined = Expect<Equal<typeof joined, Queryable<{ order: number; who: string }>>>;

// leftJoin: the inner row is nullable in the result selector — strict TS
// forces the same null-handling SQL produces.
const leftJoined = navDb.orders.leftJoin(
  navDb.users,
  (o) => o.userId,
  (u) => u.id,
  (o, u) => ({ order: o.id, who: u?.name ?? null }),
);
type _leftJoined = Expect<
  Equal<typeof leftJoined, Queryable<{ order: number; who: string | null }>>
>;

navDb.orders.leftJoin(
  navDb.users,
  (o) => o.userId,
  (u) => u.id,
  // @ts-expect-error — `u` may be null; unguarded access is rejected.
  (o, u) => ({ who: u.name }),
);

// Navigation predicates read like plain JS: optional chaining may yield
// `boolean | undefined`, and Pred accepts it.
navDb.users.where((u) => u.orders?.some((o) => o.total > 10));
navDb.users.every((u) => u.orders?.every((o) => o.total > 0));
