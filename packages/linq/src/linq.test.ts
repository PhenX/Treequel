import { memoryProvider } from "@treequel/provider-memory";
import { describe, expect, it } from "vitest";
import { type Context, createContext } from "./index.js";
import { type Fixtures, runConformance } from "./testing.js";

interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
  city: string | null;
}
interface Order {
  id: number;
  userId: number;
  total: number;
}
interface Schema {
  users: User;
  orders: Order;
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
];

const fixtures: Fixtures = { users, orders };
const db = (): Context<Schema> => createContext<Schema>(memoryProvider(fixtures));

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
    expect((await db().users.orderBy((u) => u.id).first()).id).toBe(1);
    expect(await db().users.firstOrNull((u) => u.age > 100)).toBeNull();
    expect((await db().users.single((u) => u.name === "Grace")).id).toBe(3);
    expect(await db().users.count((u) => u.age >= 18)).toBe(3);
    expect(await db().users.any((u) => u.age < 18)).toBe(true);
    expect(await db().users.all((u) => u.age > 0)).toBe(true);
    expect(await db().orders.sum((o) => o.total)).toBe(35);
    expect(await db().orders.avg((o) => o.total)).toBeCloseTo(35 / 3);
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
    const text = await db().users.where((u) => u.active).explain();
    expect(text).toContain("memory scan");
  });
});

describe("conformance harness self-check (oracle vs memory)", () => {
  it("every default case matches the oracle", async () => {
    const results = await runConformance((fx) => memoryProvider(fx), { fixtures });
    const failures = results.filter((r) => !r.equal);
    expect(failures).toEqual([]);
    expect(results.length).toBeGreaterThan(8);
  });
});
