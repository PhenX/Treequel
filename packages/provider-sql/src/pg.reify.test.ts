import { PGlite } from "@electric-sql/pglite";
import { memoryProvider } from "@treequel/provider-memory";
import { type Context, createContext, expr } from "@treequel/linq";
import { beforeAll, describe, expect, it } from "vitest";
import { type SchemaMeta, type SqlExecutor, sqlProvider } from "./index.js";

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
  { id: 5, name: "50%off", age: 25, active: true, city: "Paris" },
  { id: 6, name: "a_b", age: 30, active: false, city: "Paris" },
];
const orders: Order[] = [
  { id: 1, userId: 1, total: 10.5 },
  { id: 2, userId: 1, total: 20 },
  { id: 3, userId: 3, total: 5 },
];

const schema: SchemaMeta = {
  users: { table: "users" },
  orders: { table: "orders", columns: { userId: "user_id" } },
};

let sqlDb: Context<Schema>;
let memDb: Context<Schema>;

beforeAll(async () => {
  const pg = await PGlite.create();
  // COLLATE "C" gives byte-order string comparison, matching the JS oracle exactly.
  await pg.exec(`
    CREATE TABLE users (id int primary key, name text COLLATE "C", age int, active boolean, city text COLLATE "C");
    CREATE TABLE orders (id int primary key, user_id int, total float8);
  `);
  for (const u of users) {
    await pg.query(`INSERT INTO users VALUES ($1,$2,$3,$4,$5)`, [
      u.id,
      u.name,
      u.age,
      u.active,
      u.city,
    ]);
  }
  for (const o of orders) {
    await pg.query(`INSERT INTO orders VALUES ($1,$2,$3)`, [o.id, o.userId, o.total]);
  }
  const executor: SqlExecutor = (text, values) => pg.query(text, values) as ReturnType<SqlExecutor>;

  sqlDb = createContext<Schema>(sqlProvider(executor, schema));
  memDb = createContext<Schema>(memoryProvider({ users, orders }));
});

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => (a < b ? -1 : 1)))
      : (val as unknown),
  );

const multiset = (a: unknown[]): string[] => a.map(canon).sort();

describe("pg provider ≡ memory oracle (reified trees run on PGlite)", () => {
  it("where: numeric predicate", async () => {
    const p = expr((u: User) => u.age >= 30);
    expect(multiset(await sqlDb.users.where(p).toArray())).toEqual(
      multiset(await memDb.users.where(p).toArray()),
    );
  });

  it("where: boolean column + AND", async () => {
    const p = expr((u: User) => u.active && u.age > 20);
    expect(multiset(await sqlDb.users.where(p).toArray())).toEqual(
      multiset(await memDb.users.where(p).toArray()),
    );
  });

  it("where: null comparison (city === null → IS NULL)", async () => {
    const p = expr((u: User) => u.city === null);
    const sql = await sqlDb.users.where(p).toArray();
    expect(sql.map((u) => u.id)).toEqual([3]);
    expect(multiset(sql)).toEqual(multiset(await memDb.users.where(p).toArray()));
  });

  it("where: startsWith escapes LIKE metacharacters", async () => {
    const p = expr((u: User) => u.name.startsWith("50%"));
    const sql = await sqlDb.users.where(p).toArray();
    // Only "50%off" — the % is escaped, so it does NOT act as a wildcard.
    expect(sql.map((u) => u.name)).toEqual(["50%off"]);
    expect(multiset(sql)).toEqual(multiset(await memDb.users.where(p).toArray()));
  });

  it("where: startsWith escapes underscore", async () => {
    const p = expr((u: User) => u.name.startsWith("a_"));
    const sql = await sqlDb.users.where(p).toArray();
    expect(sql.map((u) => u.name)).toEqual(["a_b"]);
    expect(multiset(sql)).toEqual(multiset(await memDb.users.where(p).toArray()));
  });

  it("select: object projection", async () => {
    const s = expr((u: User) => ({ id: u.id, upper: u.name.toUpperCase() }));
    const p = expr((u: User) => u.active);
    expect(multiset(await sqlDb.users.where(p).select(s).toArray())).toEqual(
      multiset(await memDb.users.where(p).select(s).toArray()),
    );
  });

  it("select scalar + distinct", async () => {
    const s = expr((u: User) => u.city);
    expect(multiset(await sqlDb.users.select(s).distinct().toArray())).toEqual(
      multiset(await memDb.users.select(s).distinct().toArray()),
    );
  });

  it("orderBy numeric asc, then take", async () => {
    const k = expr((u: User) => u.age);
    expect(await sqlDb.users.orderBy(k).take(3).toArray()).toEqual(
      await memDb.users.orderBy(k).take(3).toArray(),
    );
  });

  it("orderByDescending + thenBy (deterministic across engines)", async () => {
    const active = expr((u: User) => u.active);
    const age = expr((u: User) => u.age);
    expect(await sqlDb.users.orderByDescending(active).thenBy(age).toArray()).toEqual(
      await memDb.users.orderByDescending(active).thenBy(age).toArray(),
    );
  });

  it("orderBy string column with nulls last", async () => {
    const k = expr((u: User) => u.city);
    const id = expr((u: User) => u.id);
    expect(await sqlDb.users.orderBy(k).thenBy(id).toArray()).toEqual(
      await memDb.users.orderBy(k).thenBy(id).toArray(),
    );
  });

  it("skip", async () => {
    const id = expr((u: User) => u.id);
    expect(await sqlDb.users.orderBy(id).skip(2).toArray()).toEqual(
      await memDb.users.orderBy(id).skip(2).toArray(),
    );
  });

  it("executors: count / count(pred) / any / all / sum / avg", async () => {
    const pred = expr((u: User) => u.age > 30);
    const total = expr((o: Order) => o.total);
    const positive = expr((u: User) => u.age > 0);

    expect(await sqlDb.users.count()).toBe(await memDb.users.count());
    expect(await sqlDb.users.count(pred)).toBe(await memDb.users.count(pred));
    expect(await sqlDb.users.any(pred)).toBe(await memDb.users.any(pred));
    expect(await sqlDb.users.all(positive)).toBe(await memDb.users.all(positive));
    expect(await sqlDb.orders.sum(total)).toBeCloseTo((await memDb.orders.sum(total)) as number);
    expect(await sqlDb.orders.avg(total)).toBeCloseTo((await memDb.orders.avg(total)) as number);
  });

  it("first / single", async () => {
    const id = expr((u: User) => u.id);
    expect((await sqlDb.users.orderBy(id).first()).id).toBe(1);
    const grace = expr((u: User) => u.name === "Grace");
    expect((await sqlDb.users.single(grace)).id).toBe(3);
  });
});

describe("pg provider — SQL shape (explain)", () => {
  it("parameterizes constants and never interpolates", async () => {
    const p = expr((u: User) => u.age >= 18 && u.name.startsWith("A"));
    const text = await sqlDb.users.where(p).explain();
    expect(text).toContain('FROM "users" "users"');
    expect(text).toContain('"users"."age" >= $1');
    expect(text).toContain("LIKE $2 ESCAPE");
    expect(text).not.toContain("'A%'"); // the value is a param, not inlined
  });

  it("renders LIMIT/OFFSET and ORDER BY", async () => {
    const k = expr((u: User) => u.age);
    const text = await sqlDb.users.orderByDescending(k).take(5).skip(2).explain();
    expect(text).toMatch(/ORDER BY .*DESC/);
    expect(text).toContain("LIMIT 5");
    expect(text).toContain("OFFSET 2");
  });

  it("fails fast on an untranslatable op via the capability pre-check", async () => {
    const k = expr((u: User) => u.city);
    await expect(sqlDb.users.groupBy(k).toArray()).rejects.toThrow(/R2001/);
  });
});
