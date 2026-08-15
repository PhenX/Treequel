import { memoryProvider } from "@treequel/provider-memory";
import { describe, expect, it } from "vitest";
import { type Context, createContext, defineRelations } from "./index.js";
import { type Fixtures, defaultRelations, runConformance } from "./testing.js";

interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
  city: string | null;
  orders?: Order[];
}
interface Order {
  id: number;
  userId: number | null;
  total: number;
  user?: User | null;
  items?: Item[];
}
interface Item {
  id: number;
  orderId: number;
  sku: string;
}
interface Schema {
  users: User;
  orders: Order;
  items: Item;
}

const users: User[] = [
  { id: 1, name: "Ada", age: 36, active: true, city: "London" },
  { id: 2, name: "Alan", age: 41, active: false, city: "London" },
  { id: 3, name: "Grace", age: 45, active: true, city: null },
  { id: 4, name: "Bob", age: 17, active: true, city: "NYC" },
];
const orders: Order[] = [
  { id: 1, userId: 1, total: 10 },
  { id: 2, userId: 1, total: 20 },
  { id: 3, userId: 3, total: 5 },
  { id: 4, userId: null, total: 7 },
];
const items: Item[] = [
  { id: 1, orderId: 1, sku: "apple" },
  { id: 2, orderId: 1, sku: "pear" },
  { id: 3, orderId: 3, sku: "plum" },
];

const relations = defineRelations<Schema>({
  users: {
    orders: { kind: "many", target: "orders", from: "id", to: "userId" },
  },
  orders: {
    user: { kind: "one", target: "users", from: "userId", to: "id" },
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
});

const fixtures: Fixtures = { users, orders, items };
const db = (): Context<Schema> => createContext<Schema>(memoryProvider(fixtures), { relations });

describe("Queryable over the memory provider", () => {
  it("filters and projects", async () => {
    const rows = await db()
      .users.where((u) => u.age >= 18 && u.active)
      .select((u) => ({ id: u.id, name: u.name }))
      .toArray();
    expect(rows).toEqual([
      { id: 1, name: "Ada" },
      { id: 3, name: "Grace" },
    ]);
  });

  it("is immutable — each operator returns a new query", async () => {
    const base = db().users.where((u) => u.active);
    const younger = base.where((u) => u.age < 40);
    expect(await base.count()).toBe(3);
    expect(await younger.count()).toBe(2);
  });

  it("orders, then takes and skips", async () => {
    const oldestTwo = await db()
      .users.orderByDescending((u) => u.age)
      .take(2)
      .toArray();
    expect(oldestTwo.map((u) => u.name)).toEqual(["Grace", "Alan"]);

    const skipped = await db()
      .users.orderBy((u) => u.id)
      .skip(2)
      .toArray();
    expect(skipped.map((u) => u.id)).toEqual([3, 4]);
  });

  it("multi-key ordering via thenBy is stable", async () => {
    const rows = await db()
      .users.orderBy((u) => u.city)
      .thenByDescending((u) => u.age)
      .toArray();
    // London (Alan 41, Ada 36), NYC (Bob), then null city (Grace) last
    expect(rows.map((u) => u.name)).toEqual(["Alan", "Ada", "Bob", "Grace"]);
  });

  it("executors: first / firstOrNull / single / count / any / all / sum / avg", async () => {
    expect(
      (
        await db()
          .users.orderBy((u) => u.id)
          .first()
      ).id,
    ).toBe(1);
    expect(await db().users.firstOrNull((u) => u.age > 100)).toBeNull();
    expect((await db().users.single((u) => u.name === "Grace")).id).toBe(3);
    expect(await db().users.count((u) => u.age >= 18)).toBe(3);
    expect(await db().users.any((u) => u.age < 18)).toBe(true);
    expect(await db().users.all((u) => u.age > 0)).toBe(true);
    expect(await db().orders.sum((o) => o.total)).toBe(42);
    expect(await db().orders.avg((o) => o.total)).toBeCloseTo(42 / 4);
  });

  it("single() throws on cardinality violations", async () => {
    await expect(db().users.single((u) => u.city === "London")).rejects.toThrow(/more than one/);
    await expect(db().users.single((u) => u.age > 100)).rejects.toThrow(/no element/);
  });

  it("groups by a key", async () => {
    const groups = await db()
      .users.groupBy((u) => u.city)
      .toArray();
    const byCity = Object.fromEntries(groups.map((g) => [String(g.key), g.items.length]));
    expect(byCity).toEqual({ London: 2, null: 1, NYC: 1 });
  });

  it("async iteration yields rows", async () => {
    const names: string[] = [];
    for await (const u of db().users.where((u) => u.active)) names.push(u.name);
    expect(names.sort()).toEqual(["Ada", "Bob", "Grace"]);
  });

  it(".inMemory() runs the provider prefix then evaluates the suffix locally", async () => {
    const scoreModel = (u: User): number => u.age / 100;
    const rows = await db()
      .users.where((u) => u.active) // provider prefix
      .inMemory()
      .where((u) => scoreModel(u) > 0.4) // arbitrary JS after the boundary
      .toArray();
    expect(rows.map((u) => u.name)).toEqual(["Grace"]);
  });

  it("explain() renders a plan", async () => {
    const text = await db()
      .users.where((u) => u.active)
      .explain();
    expect(text).toContain("memory scan");
  });
});

describe("joins", () => {
  it("hash-joins two sources", async () => {
    const rows = await db()
      .orders.join(
        db().users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    expect(rows).toEqual([
      { order: 1, who: "Ada" },
      { order: 2, who: "Ada" },
      { order: 3, who: "Grace" },
    ]);
  });

  it("null keys never match (SQL semantics)", async () => {
    const rows = await db()
      .orders.join(
        db().users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    // order 4 has userId: null — excluded even though no user id is null.
    expect(rows.map((r) => r.order)).not.toContain(4);
  });

  it("leftJoin keeps unmatched outer rows with a null partner", async () => {
    const rows = await db()
      .orders.leftJoin(
        db().users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u?.name ?? null }),
      )
      .toArray();
    expect(rows).toEqual([
      { order: 1, who: "Ada" },
      { order: 2, who: "Ada" },
      { order: 3, who: "Grace" },
      { order: 4, who: null },
    ]);
  });

  it("joins a filtered inner query", async () => {
    const rows = await db()
      .users.join(
        db().orders.where((o) => o.total >= 10),
        (u) => u.id,
        (o) => o.userId,
        (u, o) => ({ name: u.name, total: o.total }),
      )
      .toArray();
    expect(rows).toEqual([
      { name: "Ada", total: 10 },
      { name: "Ada", total: 20 },
    ]);
  });

  it("joins on composite keys", async () => {
    const rows = await db()
      .orders.join(
        db().users,
        (o) => ({ id: o.userId, active: true }),
        (u) => ({ id: u.id, active: u.active }),
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    expect(rows.map((r) => r.who).sort()).toEqual(["Ada", "Ada", "Grace"]);
  });
});

describe("includes", () => {
  it("include() loads a collection navigation", async () => {
    const rows = await db()
      .users.where((u) => u.id === 1)
      .include((u) => u.orders)
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orders.map((o) => o.id).sort()).toEqual([1, 2]);
  });

  it("include() loads a reference navigation as row-or-null", async () => {
    const rows = await db()
      .orders.include((o) => o.user)
      .orderBy((o) => o.id)
      .toArray();
    expect(rows.map((o) => o.user?.name ?? null)).toEqual(["Ada", "Ada", "Grace", null]);
  });

  it("attaches empty arrays for parents without children", async () => {
    const bob = await db()
      .users.include((u) => u.orders)
      .single((u) => u.name === "Bob");
    expect(bob.orders).toEqual([]);
  });

  it("thenInclude() loads nested navigations", async () => {
    const rows = await db()
      .users.include((u) => u.orders)
      .thenInclude((o) => o.items)
      .orderBy((u) => u.id)
      .toArray();
    const ada = rows.find((u) => u.name === "Ada");
    const skus = ada?.orders.flatMap((o) => o.items?.map((i) => i.sku) ?? []).sort();
    expect(skus).toEqual(["apple", "pear"]);
    const grace = rows.find((u) => u.name === "Grace");
    expect(grace?.orders[0]?.items?.map((i) => i.sku)).toEqual(["plum"]);
  });

  it("merges repeated include() of the same navigation", async () => {
    const rows = await db()
      .orders.where((o) => o.id === 1)
      .include((o) => o.items)
      .include((o) => o.user)
      .include((o) => o.items)
      .toArray();
    expect(rows[0]?.items.map((i) => i.sku).sort()).toEqual(["apple", "pear"]);
    expect(rows[0]?.user?.name).toBe("Ada");
  });

  it("include() composes with where/orderBy/take", async () => {
    const rows = await db()
      .users.include((u) => u.orders)
      .where((u) => u.active)
      .orderByDescending((u) => u.age)
      .take(2)
      .toArray();
    expect(rows.map((u) => u.name)).toEqual(["Grace", "Ada"]);
    expect(rows[1]?.orders).toHaveLength(2);
  });

  it("does not mutate fixture rows when attaching", async () => {
    await db()
      .users.include((u) => u.orders)
      .toArray();
    expect("orders" in (users[0] as object)).toBe(false);
  });

  it("throws R2007 for an undeclared navigation", () => {
    expect(() => db().users.include((u) => (u as unknown as { boss: User }).boss)).toThrow(
      /R2007|Unknown navigation/,
    );
  });

  it("throws R2008 for a selector that is not a single property access", () => {
    expect(() => db().users.include((u) => (u as unknown as { a: { b: User[] } }).a.b)).toThrow(
      /single property access/,
    );
  });

  it("throws R2008 when thenInclude does not follow include", () => {
    const q = db().users.include((u) => u.orders) as unknown as {
      where: (p: (u: User) => boolean) => {
        thenInclude?: (n: (o: Order) => Item[] | undefined) => unknown;
      };
    };
    const afterWhere = q.where((u) => u.active);
    expect(() => afterWhere.thenInclude?.((o) => o.items)).toThrow(/thenInclude/);
  });

  it("throws R2002 when the parent key was projected away", async () => {
    await expect(
      db()
        .users.select((u) => ({ name: u.name }))
        .include((u) => (u as unknown as User).orders)
        .toArray(),
    ).rejects.toThrow(/requires the key 'id'/);
  });
});

describe("conformance harness self-check (reference vs memory)", () => {
  it("every default case matches the reference", async () => {
    const results = await runConformance((fx) => memoryProvider(fx), {
      fixtures,
      relations: defaultRelations(),
    });
    const failures = results.filter((r) => !r.equal);
    expect(failures).toEqual([]);
    expect(results.length).toBeGreaterThan(12);
  });
});
