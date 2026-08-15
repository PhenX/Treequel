import { PGlite } from "@electric-sql/pglite";
import { memoryProvider } from "@treequel/provider-memory";
import { type Context, createContext, expr } from "@treequel/linq";
import {
  type Fixtures,
  type SampleItem as Item,
  type SampleOrder as Order,
  type SampleSchema as Schema,
  type SampleUser as User,
  defaultRelations,
  multiset,
  runConformance,
  sampleItems as items,
  sampleOrders as orders,
  sampleRelations as relations,
  sampleUsers as users,
} from "@treequel/linq/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { type SchemaMeta, type SqlExecutor, postgres } from "./index.js";

// Mapped physical columns on purpose: include stitching must read `user_id`.
const schema: SchemaMeta = {
  users: { table: "users" },
  orders: { table: "orders", columns: { userId: "user_id" } },
  items: { table: "items", columns: { orderId: "order_id" } },
};

// A bespoke table with a date column: the sample corpus has none. The suite runs
// under TZ=UTC (vitest config) and PGlite defaults to UTC, so the memory getters
// (local time) read the same calendar fields EXTRACT does.
interface Event {
  id: number;
  at: Date;
}
interface EventsSchema {
  events: Event;
}
const eventsSchema: SchemaMeta = { events: { table: "events" } };
const events: Event[] = [
  { id: 1, at: new Date("2019-12-31T00:00:00Z") },
  { id: 2, at: new Date("2020-01-01T00:00:00Z") },
  { id: 3, at: new Date("2020-06-15T12:00:00Z") },
  { id: 4, at: new Date("2021-03-08T00:00:00Z") },
];

// The contexts are module-level consts so the build plugin traces them and
// reifies inline lambdas; the executor is bound once PGlite is ready.
let executor: SqlExecutor;
const sqlDb: Context<Schema> = createContext<Schema>(
  postgres((text, values) => executor(text, values), schema),
  { relations },
);
const memDb: Context<Schema> = createContext<Schema>(memoryProvider({ users, orders, items }), {
  relations,
});
const eventsSql: Context<EventsSchema> = createContext<EventsSchema>(
  postgres((text, values) => executor(text, values), eventsSchema),
);
const eventsMem: Context<EventsSchema> = createContext<EventsSchema>(memoryProvider({ events }));

beforeAll(async () => {
  const pg = await PGlite.create();
  // COLLATE "C" gives byte-order string comparison, matching the JS reference exactly.
  await pg.exec(`
    CREATE TABLE users (id int primary key, name text COLLATE "C", age int, active boolean, city text COLLATE "C");
    CREATE TABLE orders (id int primary key, user_id int, total float8);
    CREATE TABLE items (id int primary key, order_id int, sku text COLLATE "C");
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
  for (const i of items) {
    await pg.query(`INSERT INTO items VALUES ($1,$2,$3)`, [i.id, i.orderId, i.sku]);
  }
  await pg.exec(`CREATE TABLE events (id int primary key, at timestamptz);`);
  for (const e of events) {
    await pg.query(`INSERT INTO events VALUES ($1,$2)`, [e.id, e.at]);
  }
  executor = (text, values) => pg.query(text, values) as ReturnType<SqlExecutor>;
});

describe("pg provider ≡ memory reference (reified trees run on PGlite)", () => {
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

  it("where after an object projection (wraps into a derived table)", async () => {
    const rows = await sqlDb.users
      .select((u) => ({ id: u.id, years: u.age }))
      .where((r) => r.years > 30)
      .toArray();
    const mem = await memDb.users
      .select((u) => ({ id: u.id, years: u.age }))
      .where((r) => r.years > 30)
      .toArray();
    expect(multiset(rows)).toEqual(multiset(mem));
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

  it("executors: count / count(pred) / some / every / sum / avg", async () => {
    const pred = expr((u: User) => u.age > 30);
    const total = expr((o: Order) => o.total);
    const positive = expr((u: User) => u.age > 0);

    expect(await sqlDb.users.count()).toBe(await memDb.users.count());
    expect(await sqlDb.users.count(pred)).toBe(await memDb.users.count(pred));
    expect(await sqlDb.users.some(pred)).toBe(await memDb.users.some(pred));
    expect(await sqlDb.users.every(positive)).toBe(await memDb.users.every(positive));
    expect(await sqlDb.orders.sum(total)).toBeCloseTo((await memDb.orders.sum(total)) as number);
    expect(await sqlDb.orders.avg(total)).toBeCloseTo((await memDb.orders.avg(total)) as number);
  });

  it("firstOrThrow / single", async () => {
    const id = expr((u: User) => u.id);
    expect((await sqlDb.users.orderBy(id).firstOrThrow()).id).toBe(1);
    const grace = expr((u: User) => u.name === "Grace");
    expect((await sqlDb.users.single(grace)).id).toBe(3);
  });
});

describe("pg date extraction ≡ memory reference", () => {
  const eid = (rs: Event[]): number[] => rs.map((e) => e.id).sort((a, b) => a - b);

  it("projects getFullYear/getMonth/getDate the same as the JS getters", async () => {
    const s = expr((e: Event) => ({
      id: e.id,
      y: e.at.getFullYear(),
      m: e.at.getMonth(),
      d: e.at.getDate(),
    }));
    expect(multiset(await eventsSql.events.select(s).toArray())).toEqual(
      multiset(await eventsMem.events.select(s).toArray()),
    );
  });

  it("filters on getFullYear and the 0-based getMonth match the reference", async () => {
    const in2020 = expr((e: Event) => e.at.getFullYear() === 2020);
    const inJune = expr((e: Event) => e.at.getMonth() === 5); // 5 = June (0-based)
    expect(eid(await eventsSql.events.where(in2020).toArray())).toEqual([2, 3]);
    expect(eid(await eventsSql.events.where(in2020).toArray())).toEqual(
      eid(await eventsMem.events.where(in2020).toArray()),
    );
    expect(eid(await eventsSql.events.where(inJune).toArray())).toEqual(
      eid(await eventsMem.events.where(inJune).toArray()),
    );
  });

  it("binds a captured Date comparison against the reference", async () => {
    const cutoff = new Date("2020-01-01T00:00:00Z");
    const p = expr((e: Event) => e.at >= cutoff);
    expect(eid(await eventsSql.events.where(p).toArray())).toEqual([2, 3, 4]);
    expect(eid(await eventsSql.events.where(p).toArray())).toEqual(
      eid(await eventsMem.events.where(p).toArray()),
    );
  });

  it("compiles to EXTRACT with the 0-based month adjustment", async () => {
    const text = await eventsSql.events
      .select(expr((e: Event) => ({ m: e.at.getMonth() })))
      .explain();
    expect(text).toContain("EXTRACT(MONTH FROM");
    expect(text).toContain("- 1)");
  });
});

describe("pg joins ≡ memory reference", () => {
  it("inner join projects across both sides and skips null keys", async () => {
    const sql = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    const mem = await memDb.orders
      .join(
        memDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
    expect(sql.map((r) => r.order)).not.toContain(4);
  });

  it("leftJoin keeps unmatched outer rows with SQL NULLs", async () => {
    const sql = await sqlDb.orders
      .leftJoin(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u?.name ?? null }),
      )
      .toArray();
    const mem = await memDb.orders
      .leftJoin(
        memDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u?.name ?? null }),
      )
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
    expect(sql).toHaveLength(4);
  });

  it("joins on composite object keys", async () => {
    const sql = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => ({ key: o.userId, on: true }),
        (u) => ({ key: u.id, on: u.active }),
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    const mem = await memDb.orders
      .join(
        memDb.users,
        (o) => ({ key: o.userId, on: true }),
        (u) => ({ key: u.id, on: u.active }),
        (o, u) => ({ order: o.id, who: u.name }),
      )
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
  });

  it("aggregates over a joined projection", async () => {
    const sql = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ who: u.name, total: o.total }),
      )
      .sum((r) => r.total);
    const mem = await memDb.orders
      .join(
        memDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ who: u.name, total: o.total }),
      )
      .sum((r) => r.total);
    expect(sql).toBeCloseTo(mem);
  });
});

describe("pg includes (split queries) ≡ memory reference", () => {
  it("include() + thenInclude() load nested navigations through mapped columns", async () => {
    const sql = await sqlDb.users
      .include((u) => u.orders)
      .thenInclude((o) => o.items)
      .where((u) => u.id === 1)
      .toArray();
    const skus = sql[0]?.orders.flatMap((o) => (o.items ?? []).map((i) => i.sku)).sort();
    expect(skus).toEqual(["apple", "pear"]);
  });

  it("include() loads a reference navigation as row-or-null", async () => {
    const rows = await sqlDb.orders
      .include((o) => o.user)
      .orderBy((o) => o.id)
      .toArray();
    expect(rows.map((o) => o.user?.name ?? null)).toEqual(["Ada", "Ada", "Grace", null]);
  });

  it("include() on a nullable first() attaches to the single row", async () => {
    const ada = await sqlDb.users.include((u) => u.orders).first((u) => u.id === 1);
    expect(ada?.orders.map((o) => o.id).sort()).toEqual([1, 2]);
    const nobody = await sqlDb.users.include((u) => u.orders).first((u) => u.id === 99);
    expect(nobody).toBeNull();
  });

  it("fetches each navigation as one ANY() batch — root plus one query per level", async () => {
    let statements = 0;
    const counting: SqlExecutor = (text, values) => {
      statements++;
      return executor(text, values);
    };
    const counted = createContext<Schema>(postgres(counting, schema), { relations });
    const rows = await counted.users
      .include((u) => u.orders)
      .thenInclude((o) => o.items)
      .toArray();
    expect(rows).toHaveLength(6);
    expect(statements).toBe(3);
  });
});

describe("pg provider — SQL shape (explain)", () => {
  it("parameterizes constants and never interpolates", async () => {
    const p = expr((u: User) => u.age >= 18 && u.name.startsWith("A"));
    const text = await sqlDb.users.where(p).explain();
    expect(text).toContain('FROM "users" "t0"');
    expect(text).toContain('"t0"."age" >= $1');
    expect(text).toContain("LIKE $2 ESCAPE");
    expect(text).not.toContain("'A%'"); // the value is a param, not inlined
  });

  it("composes take then skip into the slice they describe", async () => {
    const k = expr((u: User) => u.age);
    const text = await sqlDb.users.orderByDescending(k).take(5).skip(2).explain();
    expect(text).toMatch(/ORDER BY .*DESC/);
    // take(5).skip(2) keeps rows 3..5 of the ordered set — three rows.
    expect(text).toContain("LIMIT 3");
    expect(text).toContain("OFFSET 2");
  });

  it("numbers placeholders in textual order across joined clauses", async () => {
    const text = await sqlDb.users
      .join(
        sqlDb.orders.where((o) => o.total >= 10),
        (u) => u.id,
        (o) => o.userId,
        (u, o) => ({ name: u.name, big: o.total * 2 }),
      )
      .where((r) => r.big > 25)
      .explain();
    // The SELECT-list param ($1: the 2 multiplier) precedes the JOIN subquery
    // param ($2: the 10 threshold) and the outer WHERE param ($3: 25).
    expect(text.indexOf("$1")).toBeLessThan(text.indexOf("$2"));
    expect(text.indexOf("$2")).toBeLessThan(text.indexOf("$3"));
    expect(text).toContain("INNER JOIN");
  });
});

describe("pg conformance corpus", () => {
  it("matches the reference on every default case", async () => {
    const fixtures: Fixtures = { users, orders, items };
    const results = await runConformance(
      async (fx) => {
        const pg = await PGlite.create();
        // Identity column names so full-row canonical comparison is meaningful.
        await pg.exec(`
          CREATE TABLE users (id int primary key, name text COLLATE "C", age int, active boolean, city text COLLATE "C");
          CREATE TABLE orders (id int primary key, "userId" int, total float8);
          CREATE TABLE items (id int primary key, "orderId" int, sku text COLLATE "C");
        `);
        for (const u of fx.users as User[]) {
          await pg.query(`INSERT INTO users VALUES ($1,$2,$3,$4,$5)`, [
            u.id,
            u.name,
            u.age,
            u.active,
            u.city,
          ]);
        }
        for (const o of fx.orders as Order[]) {
          await pg.query(`INSERT INTO orders VALUES ($1,$2,$3)`, [o.id, o.userId, o.total]);
        }
        for (const i of fx.items as Item[]) {
          await pg.query(`INSERT INTO items VALUES ($1,$2,$3)`, [i.id, i.orderId, i.sku]);
        }
        const exec: SqlExecutor = (text, values) =>
          pg.query(text, values) as ReturnType<SqlExecutor>;
        return postgres(exec, {
          users: { table: "users" },
          orders: { table: "orders" },
          items: { table: "items" },
        });
      },
      { fixtures, relations: defaultRelations() },
    );
    const failures = results.filter((r) => !r.equal).map((r) => r.name);
    expect(failures).toEqual([]);
  }, 30_000);
});
