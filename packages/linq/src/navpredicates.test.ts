import { enableFallback } from "@treequel/fallback";
import { memoryProvider } from "@treequel/provider-memory";
import { describe, expect, it } from "vitest";
import { type Context, createContext, defineRelations } from "./index.js";

enableFallback();

interface User {
  id: number;
  name: string;
  active: boolean;
  orders?: Order[];
}
interface Order {
  id: number;
  userId: number | null;
  total: number;
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
  { id: 1, name: "Ada", active: true },
  { id: 2, name: "Alan", active: false },
  { id: 3, name: "Grace", active: true },
];
const orders: Order[] = [
  { id: 1, userId: 1, total: 10 },
  { id: 2, userId: 1, total: 20 },
  { id: 3, userId: 3, total: 5 },
];
const items: Item[] = [
  { id: 1, orderId: 1, sku: "apple" },
  { id: 2, orderId: 3, sku: "plum" },
];

const relations = defineRelations<Schema>({
  users: {
    orders: { kind: "many", target: "orders", from: "id", to: "userId" },
  },
  orders: {
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
});

const db = (): Context<Schema> =>
  createContext<Schema>(memoryProvider({ users, orders, items }), { relations });

// The runtime fallback is enabled above, so these plain lambdas gain trees
// on demand — the same navigation resolution the build plugin enables.
describe("navigation predicates (memory, runtime-parsed trees)", () => {
  it("some() over a navigation filters like EXISTS", async () => {
    const rows = await db()
      .users.filter((u) => u.orders?.some((o) => o.total >= 10))
      .toArray();
    expect(rows.map((u) => u.name)).toEqual(["Ada"]);
  });

  it("every() over a navigation is vacuously true for parents without children", async () => {
    const rows = await db()
      .users.filter((u) => u.orders?.every((o) => o.total >= 10))
      .toArray();
    // Ada (10, 20) and Alan (no orders) — Grace's order 5 fails the test.
    expect(rows.map((u) => u.name).sort()).toEqual(["Ada", "Alan"]);
  });

  it("negation and column predicates combine with navigation tests", async () => {
    const inactive = await db()
      .users.filter((u) => u.active && u.orders?.some((o) => o.total > 5))
      .toArray();
    expect(inactive.map((u) => u.name)).toEqual(["Ada"]);

    const none = await db()
      .users.filter((u) => !u.orders?.some((o) => o.total > 0))
      .toArray();
    expect(none.map((u) => u.name)).toEqual(["Alan"]);
  });

  it("navigation tests nest across two levels", async () => {
    const rows = await db()
      .users.filter((u) => u.orders?.some((o) => o.items?.some((i) => i.sku === "apple")))
      .toArray();
    expect(rows.map((u) => u.name)).toEqual(["Ada"]);
  });

  it("works in executor positions", async () => {
    expect(await db().users.count((u) => u.orders?.some((o) => o.total > 5))).toBe(1);
    expect(await db().users.some((u) => u.orders?.some((o) => o.total > 15))).toBe(true);
    expect(await db().users.every((u) => u.orders?.every((o) => o.total > 0))).toBe(true);
    const grace = await db().users.first((u) => u.orders?.some((o) => o.total === 5));
    expect(grace?.name).toBe("Grace");
  });

  it("does not leak attached navigations into the results", async () => {
    const rows = await db()
      .users.filter((u) => u.orders?.some((o) => o.total >= 10))
      .toArray();
    expect(rows).toHaveLength(1);
    expect("orders" in (rows[0] as object)).toBe(false);
    expect("orders" in (users[0] as object)).toBe(false);
  });
});

describe("correlated projections and aggregates (memory, runtime-parsed trees)", () => {
  it("projects a navigation count and a filtered count", async () => {
    const rows = await db()
      .users.map((u) => ({
        name: u.name,
        n: u.orders?.length ?? 0,
        big: u.orders?.filter((o) => o.total >= 10).length ?? 0,
      }))
      .toArray();
    expect(rows).toEqual([
      { name: "Ada", n: 2, big: 2 },
      { name: "Alan", n: 0, big: 0 },
      { name: "Grace", n: 1, big: 0 },
    ]);
  });

  it("sums a navigation via the reduce idiom", async () => {
    const rows = await db()
      .users.map((u) => ({
        name: u.name,
        spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0,
      }))
      .toArray();
    expect(rows).toEqual([
      { name: "Ada", spent: 30 },
      { name: "Alan", spent: 0 },
      { name: "Grace", spent: 5 },
    ]);
  });

  it("orders by a navigation count", async () => {
    const rows = await db()
      .users.orderByDescending((u) => u.orders?.length ?? 0)
      .thenBy((u) => u.id)
      .toArray();
    expect(rows.map((u) => u.name)).toEqual(["Ada", "Grace", "Alan"]);
  });

  it("filters inside a chain may reference child navigations", async () => {
    const rows = await db()
      .users.map((u) => ({
        name: u.name,
        withItems: u.orders?.filter((o) => o.items?.some((i) => i.sku === "apple")).length ?? 0,
      }))
      .toArray();
    expect(rows).toEqual([
      { name: "Ada", withItems: 1 },
      { name: "Alan", withItems: 0 },
      { name: "Grace", withItems: 0 },
    ]);
  });

  it("aggregates over a correlated sum", async () => {
    const total = await db().users.sum((u) => u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0);
    expect(total).toBe(35);
  });

  it("groups by a navigation count", async () => {
    const groups = await db()
      .users.groupBy((u) => u.orders?.length ?? 0)
      .toArray();
    const byCount = Object.fromEntries(groups.map((g) => [String(g.key), g.items.length]));
    expect(byCount).toEqual({ "0": 1, "1": 1, "2": 1 });
  });
});
