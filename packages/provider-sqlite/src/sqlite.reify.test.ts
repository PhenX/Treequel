import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { memoryProvider } from "@greffon/provider-memory";
import { type Context, createContext, expr } from "@greffon/query";
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
} from "@greffon/query/testing";
import { makeSqlProvider } from "@greffon/sql-core";
import { beforeAll, describe, expect, it } from "vitest";
import { type SchemaMeta, type SqlExecutor, sqlite, sqliteDialect } from "./index.js";

// Mapped physical columns on purpose: include stitching must read `user_id`.
const schema: SchemaMeta = {
  users: { table: "users" },
  orders: { table: "orders", columns: { userId: "user_id" } },
  items: { table: "items", columns: { orderId: "order_id" } },
};

// A bespoke table with a date column: the sample corpus has none because raw
// date values round-trip differently per backend (SQLite text vs a JS Date), so
// date cases compare extracted integers, never the stored value itself.
interface Event {
  id: number;
  at: Date;
}
interface EventsSchema {
  events: Event;
}
const eventsSchema: SchemaMeta = { events: { table: "events" } };
// Instants whose UTC calendar fields are unambiguous; the suite runs under
// TZ=UTC (vitest config) so the memory getters read the same fields SQL does.
const events: Event[] = [
  { id: 1, at: new Date("2019-12-31T00:00:00Z") },
  { id: 2, at: new Date("2020-01-01T00:00:00Z") },
  { id: 3, at: new Date("2020-06-15T12:00:00Z") },
  { id: 4, at: new Date("2021-03-08T00:00:00Z") },
];

interface SqlJsDb {
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): {
    bind(params: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
}

type SqlJsFactory = (opts: {
  locateFile: () => string;
}) => Promise<{ Database: new () => unknown }>;

async function openDb(): Promise<SqlJsDb> {
  const require = createRequire(import.meta.url);
  const SQL = await (initSqlJs as unknown as SqlJsFactory)({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  return new SQL.Database() as SqlJsDb;
}

function makeExecutor(db: SqlJsDb): SqlExecutor {
  return (text, values) => {
    const stmt = db.prepare(text);
    stmt.bind(values);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return Promise.resolve({ rows });
  };
}

// The contexts are module-level consts so the build plugin traces them and
// reifies inline lambdas; the executor is bound once the database is ready.
let executor: SqlExecutor;
const sqlDb: Context<Schema> = createContext<Schema>(
  sqlite((text, values) => executor(text, values), schema),
  { relations },
);
const memDb: Context<Schema> = createContext<Schema>(memoryProvider({ users, orders, items }), {
  relations,
});
const eventsSql: Context<EventsSchema> = createContext<EventsSchema>(
  sqlite((text, values) => executor(text, values), eventsSchema),
);
const eventsMem: Context<EventsSchema> = createContext<EventsSchema>(memoryProvider({ events }));

beforeAll(async () => {
  const db = await openDb();
  // SQLite has no boolean type — `active` is stored as 0/1.
  db.run("CREATE TABLE users (id int, name text, age int, active int, city text);");
  db.run("CREATE TABLE orders (id int, user_id int, total real);");
  db.run("CREATE TABLE items (id int, order_id int, sku text);");
  for (const u of users) {
    db.run("INSERT INTO users VALUES (?,?,?,?,?)", [u.id, u.name, u.age, u.active ? 1 : 0, u.city]);
  }
  for (const o of orders) {
    db.run("INSERT INTO orders VALUES (?,?,?)", [o.id, o.userId, o.total]);
  }
  for (const i of items) {
    db.run("INSERT INTO items VALUES (?,?,?)", [i.id, i.orderId, i.sku]);
  }
  // Dates store as ISO-8601 UTC text — what the dialect's coerceValue produces
  // for a bound Date, and what strftime reads.
  db.run("CREATE TABLE events (id int, at text);");
  for (const e of events) {
    db.run("INSERT INTO events VALUES (?,?)", [e.id, e.at.toISOString()]);
  }
  executor = makeExecutor(db);
});

const ids = (rs: User[]): number[] => rs.map((u) => u.id).sort((a, b) => a - b);
const evIds = (rs: Event[]): number[] => rs.map((e) => e.id).sort((a, b) => a - b);

describe("SQLite provider ≡ memory reference (reified trees on sql.js)", () => {
  it("filter: numeric predicate", async () => {
    const p = expr((u: User) => u.age >= 30);
    expect(ids(await sqlDb.users.filter(p).toArray())).toEqual(
      ids(await memDb.users.filter(p).toArray()),
    );
  });

  it("filter: boolean column (0/1) + AND", async () => {
    const p = expr((u: User) => u.active && u.age > 20);
    expect(ids(await sqlDb.users.filter(p).toArray())).toEqual(
      ids(await memDb.users.filter(p).toArray()),
    );
  });

  it("filter: null comparison (city === null → IS NULL)", async () => {
    const p = expr((u: User) => u.city === null);
    const sql = await sqlDb.users.filter(p).toArray();
    expect(sql.map((u) => u.id)).toEqual([3]);
    expect(ids(sql)).toEqual(ids(await memDb.users.filter(p).toArray()));
  });

  it("filter: startsWith is case-sensitive (GLOB)", async () => {
    const p = expr((u: User) => u.name.startsWith("A"));
    // "Ada" and "Alan" — not the lowercase "a_b".
    expect((await sqlDb.users.filter(p).toArray()).map((u) => u.name).sort()).toEqual([
      "Ada",
      "Alan",
    ]);
    expect(ids(await sqlDb.users.filter(p).toArray())).toEqual(
      ids(await memDb.users.filter(p).toArray()),
    );
  });

  it("filter: startsWith escapes % (not a wildcard)", async () => {
    const p = expr((u: User) => u.name.startsWith("50%"));
    expect((await sqlDb.users.filter(p).toArray()).map((u) => u.name)).toEqual(["50%off"]);
  });

  it("filter: startsWith escapes _ and matches literally", async () => {
    const p = expr((u: User) => u.name.startsWith("a_"));
    expect((await sqlDb.users.filter(p).toArray()).map((u) => u.name)).toEqual(["a_b"]);
  });

  it("map: object projection with toUpperCase", async () => {
    const s = expr((u: User) => ({ id: u.id, upper: u.name.toUpperCase() }));
    const p = expr((u: User) => u.age > 30);
    expect(multiset(await sqlDb.users.filter(p).map(s).toArray())).toEqual(
      multiset(await memDb.users.filter(p).map(s).toArray()),
    );
  });

  it("map scalar + distinct (nulls included once)", async () => {
    const s = expr((u: User) => u.city);
    expect(multiset(await sqlDb.users.map(s).distinct().toArray())).toEqual(
      multiset(await memDb.users.map(s).distinct().toArray()),
    );
  });

  it("filter after an object projection (wraps into a derived table)", async () => {
    const s = expr((u: User) => ({ id: u.id, years: u.age }));
    const p = expr((r: { id: number; years: number }) => r.years > 30);
    expect(multiset(await sqlDb.users.map(s).filter(p).toArray())).toEqual(
      multiset(await memDb.users.map(s).filter(p).toArray()),
    );
  });

  it("filter after a scalar projection (the value is the row)", async () => {
    const s = expr((u: User) => u.age);
    const p = expr((a: number) => a > 30);
    expect(multiset(await sqlDb.users.map(s).filter(p).toArray())).toEqual(
      multiset(await memDb.users.map(s).filter(p).toArray()),
    );
  });

  it("orderBy numeric asc, then take", async () => {
    const k = expr((u: User) => u.age);
    expect((await sqlDb.users.orderBy(k).take(3).toArray()).map((u) => u.id)).toEqual(
      (await memDb.users.orderBy(k).take(3).toArray()).map((u) => u.id),
    );
  });

  it("orderBy string column, nulls last (matches Postgres/memory)", async () => {
    const k = expr((u: User) => u.city);
    const id = expr((u: User) => u.id);
    expect((await sqlDb.users.orderBy(k).thenBy(id).toArray()).map((u) => u.id)).toEqual(
      (await memDb.users.orderBy(k).thenBy(id).toArray()).map((u) => u.id),
    );
  });

  it("skip (LIMIT -1 OFFSET)", async () => {
    const id = expr((u: User) => u.id);
    expect((await sqlDb.users.orderBy(id).skip(2).toArray()).map((u) => u.id)).toEqual(
      (await memDb.users.orderBy(id).skip(2).toArray()).map((u) => u.id),
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

describe("SQLite date extraction ≡ memory reference", () => {
  it("projects getFullYear/getMonth/getDate the same as the JS getters", async () => {
    const s = expr((e: Event) => ({
      id: e.id,
      y: e.at.getFullYear(),
      m: e.at.getMonth(),
      d: e.at.getDate(),
    }));
    expect(multiset(await eventsSql.events.map(s).toArray())).toEqual(
      multiset(await eventsMem.events.map(s).toArray()),
    );
  });

  it("filters on getFullYear and the 0-based getMonth match the reference", async () => {
    const in2020 = expr((e: Event) => e.at.getFullYear() === 2020);
    const inJune = expr((e: Event) => e.at.getMonth() === 5); // 5 = June (0-based)
    expect(evIds(await eventsSql.events.filter(in2020).toArray())).toEqual([2, 3]);
    expect(evIds(await eventsSql.events.filter(in2020).toArray())).toEqual(
      evIds(await eventsMem.events.filter(in2020).toArray()),
    );
    expect(evIds(await eventsSql.events.filter(inJune).toArray())).toEqual(
      evIds(await eventsMem.events.filter(inJune).toArray()),
    );
  });

  it("binds a captured Date comparison as a coerced ISO parameter", async () => {
    const cutoff = new Date("2020-01-01T00:00:00Z");
    const p = expr((e: Event) => e.at >= cutoff);
    expect(evIds(await eventsSql.events.filter(p).toArray())).toEqual([2, 3, 4]);
    expect(evIds(await eventsSql.events.filter(p).toArray())).toEqual(
      evIds(await eventsMem.events.filter(p).toArray()),
    );
  });

  it("compiles to strftime with the 0-based month adjustment", async () => {
    const text = await eventsSql.events.map(expr((e: Event) => ({ m: e.at.getMonth() }))).explain();
    expect(text).toContain("strftime('%m'");
    expect(text).toContain("- 1)");
  });
});

describe("SQLite joins ≡ memory reference", () => {
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
    // order 4 has a NULL user_id: excluded on both engines.
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

  it("joins a filtered inner query (derived-table join)", async () => {
    const sql = await sqlDb.users
      .join(
        sqlDb.orders.filter((o) => o.total >= 10),
        (u) => u.id,
        (o) => o.userId,
        (u, o) => ({ name: u.name, total: o.total }),
      )
      .toArray();
    const mem = await memDb.users
      .join(
        memDb.orders.filter((o) => o.total >= 10),
        (u) => u.id,
        (o) => o.userId,
        (u, o) => ({ name: u.name, total: o.total }),
      )
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
  });

  it("filter over the joined projection wraps into a derived table", async () => {
    const sql = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name, total: o.total }),
      )
      .filter((r) => r.total >= 10)
      .orderBy((r) => r.order)
      .toArray();
    const mem = await memDb.orders
      .join(
        memDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u.name, total: o.total }),
      )
      .filter((r) => r.total >= 10)
      .orderBy((r) => r.order)
      .toArray();
    expect(sql).toEqual(mem);
  });
});

describe("SQLite includes (split queries) ≡ memory reference", () => {
  it("include() loads a collection through mapped columns", async () => {
    const [sqlAda] = await sqlDb.users
      .filter((u) => u.id === 1)
      .include((u) => u.orders)
      .toArray();
    const [memAda] = await memDb.users
      .filter((u) => u.id === 1)
      .include((u) => u.orders)
      .toArray();
    expect(sqlAda?.orders.map((o) => o.id).sort()).toEqual(memAda?.orders.map((o) => o.id).sort());
    expect(sqlAda?.orders).toHaveLength(2);
  });

  it("include() loads a reference navigation as row-or-null", async () => {
    const rows = await sqlDb.orders
      .include((o) => o.user)
      .orderBy((o) => o.id)
      .toArray();
    expect(rows.map((o) => o.user?.name ?? null)).toEqual(["Ada", "Ada", "Grace", null]);
  });

  it("thenInclude() loads a nested level", async () => {
    const rows = await sqlDb.users
      .include((u) => u.orders)
      .thenInclude((o) => o.items)
      .filter((u) => u.id === 1)
      .toArray();
    const skus = rows[0]?.orders.flatMap((o) => (o.items ?? []).map((i) => i.sku)).sort();
    expect(skus).toEqual(["apple", "pear"]);
  });

  it("include respects take/skip on the root query", async () => {
    const sql = await sqlDb.users
      .include((u) => u.orders)
      .orderBy((u) => u.id)
      .take(2)
      .toArray();
    expect(sql.map((u) => u.id)).toEqual([1, 2]);
    expect(sql[0]?.orders).toHaveLength(2);
    expect(sql[1]?.orders).toHaveLength(0);
  });

  it("chunks batched fetches at maxBatchKeys", async () => {
    let statements = 0;
    const counting: SqlExecutor = (text, values) => {
      statements++;
      return executor(text, values);
    };
    const provider = makeSqlProvider(
      { ...sqliteDialect, maxBatchKeys: 2 },
      "sqlite-tiny-batch",
      counting,
      schema,
    );
    const tiny = createContext<Schema>(provider, { relations });
    const rows = await tiny.users.include((u) => u.orders).toArray();
    // Root query + ceil(6 distinct user ids / 2) = 3 chunked child fetches.
    expect(statements).toBe(4);
    expect(rows.find((u) => u.id === 1)?.orders).toHaveLength(2);
  });
});

describe("SQLite provider — SQL shape (explain)", () => {
  it("uses positional ? params and case-sensitive GLOB, never $n", async () => {
    const p = expr((u: User) => u.age >= 18 && u.name.startsWith("A"));
    const text = await sqlDb.users.filter(p).explain();
    expect(text).toContain('FROM "users" "t0"');
    expect(text).toContain('"t0"."age" >= ?');
    expect(text).toContain("GLOB ?");
    expect(text).not.toContain("$1");
  });

  it("renders NULLS FIRST/LAST and the composed take/skip slice", async () => {
    const k = expr((u: User) => u.age);
    const text = await sqlDb.users.orderByDescending(k).take(5).skip(2).explain();
    expect(text).toMatch(/ORDER BY .*DESC NULLS FIRST/);
    // take(5).skip(2) keeps rows 3..5 of the ordered set — three rows.
    expect(text).toContain("LIMIT 3");
    expect(text).toContain("OFFSET 2");
  });

  it("emits LIMIT -1 for a bare OFFSET", async () => {
    const id = expr((u: User) => u.id);
    const text = await sqlDb.users.orderBy(id).skip(2).explain();
    expect(text).toContain("LIMIT -1 OFFSET 2");
  });

  it("renders INNER/LEFT JOIN with ON, and mapped join columns", async () => {
    const text = await sqlDb.orders
      .leftJoin(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ order: o.id, who: u?.name ?? null }),
      )
      .explain();
    expect(text).toContain('LEFT JOIN "users"');
    expect(text).toContain('"user_id"');
    expect(text).toMatch(/ON \(.*=.*\)/);
  });

  it("explain() lists batched include fetches", async () => {
    const text = await sqlDb.users
      .include((u) => u.orders)
      .thenInclude((o) => o.items)
      .explain();
    expect(text).toContain('-- include orders: batched SELECT FROM "orders" WHERE "user_id"');
    expect(text).toContain('-- include   items: batched SELECT FROM "items" WHERE "order_id"');
  });
});

describe("SQLite joins & includes — shapes and edges", () => {
  it("self-join uses distinct aliases for the same table", async () => {
    const text = await sqlDb.users
      .join(
        sqlDb.users,
        (u) => u.city,
        (v) => v.city,
        (u, v) => ({ a: u.id, b: v.id }),
      )
      .explain();
    expect(text).toContain('"users" "t0"');
    expect(text).toContain('INNER JOIN "users" "t1"');
    expect(text).toContain('ON ("t0"."city" = "t1"."city")');
  });

  it("a second join wraps the first into a derived table", async () => {
    const text = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ oid: o.id, who: u.name }),
      )
      .join(
        sqlDb.items,
        (r) => r.oid,
        (i) => i.orderId,
        (r, i) => ({ who: r.who, sku: i.sku }),
      )
      .explain();
    const joins = text.match(/INNER JOIN/g) ?? [];
    expect(joins).toHaveLength(2);
    expect(text).toMatch(/FROM \(SELECT .* INNER JOIN .*\) "d\d+" INNER JOIN "items"/);
  });

  it("chained joins return the same rows as the reference", async () => {
    const sql = await sqlDb.orders
      .join(
        sqlDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ oid: o.id, who: u.name }),
      )
      .join(
        sqlDb.items,
        (r) => r.oid,
        (i) => i.orderId,
        (r, i) => ({ who: r.who, sku: i.sku }),
      )
      .toArray();
    const mem = await memDb.orders
      .join(
        memDb.users,
        (o) => o.userId,
        (u) => u.id,
        (o, u) => ({ oid: o.id, who: u.name }),
      )
      .join(
        memDb.items,
        (r) => r.oid,
        (i) => i.orderId,
        (r, i) => ({ who: r.who, sku: i.sku }),
      )
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
    expect(sql.length).toBeGreaterThan(0);
  });

  it("include of a reference then its collection cycles back consistently", async () => {
    const sql = await sqlDb.orders
      .include((o) => o.user)
      .thenInclude((u) => u.orders)
      .single((o) => o.id === 3);
    expect(sql.user?.name).toBe("Grace");
    expect(sql.user?.orders?.map((o) => o.id)).toEqual([3]);
  });

  it("take(0) compiles to LIMIT 0 and returns no rows", async () => {
    const rows = await sqlDb.users.take(0).toArray();
    expect(rows).toEqual([]);
    expect(await sqlDb.users.take(0).explain()).toContain("LIMIT 0");
  });

  it("some() over a navigation compiles to a correlated EXISTS", async () => {
    const text = await sqlDb.users.filter((u) => u.orders?.some((o) => o.total > 10)).explain();
    expect(text).toMatch(/EXISTS \(SELECT 1 FROM "orders" "s\d+"/);
    expect(text).toMatch(/"s\d+"\."user_id" = "t\d+"\."id"/);
  });

  it("every() compiles to NOT EXISTS over the negated predicate", async () => {
    const text = await sqlDb.users.filter((u) => u.orders?.every((o) => o.total > 10)).explain();
    expect(text).toMatch(/NOT EXISTS \(SELECT 1 FROM "orders" .*AND \(NOT/);
  });

  it("navigation predicates match the reference through mapped columns", async () => {
    const sql = await sqlDb.users.filter((u) => u.orders?.some((o) => o.total >= 10)).toArray();
    const mem = await memDb.users.filter((u) => u.orders?.some((o) => o.total >= 10)).toArray();
    expect(ids(sql)).toEqual(ids(mem));
    expect(sql.map((u) => u.name)).toEqual(["Ada"]);
  });

  it("a navigation count compiles to a correlated COUNT subquery", async () => {
    const text = await sqlDb.users
      .map((u) => ({ name: u.name, n: u.orders?.length ?? 0 }))
      .explain();
    expect(text).toMatch(/COALESCE\(\(SELECT CAST\(COUNT\(\*\) AS REAL\) FROM "orders" "s\d+"/);
    expect(text).toMatch(/"s\d+"\."user_id" = "t\d+"\."id"/);
  });

  it("a filtered count folds the filter into the subquery WHERE", async () => {
    const text = await sqlDb.users
      .map((u) => ({ big: u.orders?.filter((o) => o.total >= 10).length ?? 0 }))
      .explain();
    expect(text).toMatch(/COUNT\(\*\).*WHERE.*AND \(\("s\d+"\."total" >= \?\)\)/);
  });

  it("the reduce sum idiom compiles to COALESCE(SUM(...), 0)", async () => {
    const text = await sqlDb.users
      .map((u) => ({ spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0 }))
      .explain();
    expect(text).toMatch(/COALESCE\(\(SELECT CAST\(SUM\("s\d+"\."total"\) AS REAL\)/);
  });

  it("correlated projections match the reference", async () => {
    const sql = await sqlDb.users
      .map((u) => ({
        name: u.name,
        n: u.orders?.length ?? 0,
        spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0,
      }))
      .toArray();
    const mem = await memDb.users
      .map((u) => ({
        name: u.name,
        n: u.orders?.length ?? 0,
        spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0,
      }))
      .toArray();
    expect(multiset(sql)).toEqual(multiset(mem));
  });

  it("rejects a reduce outside the recognized sum idiom", async () => {
    await expect(
      sqlDb.users
        .map((u) => ({ x: u.orders?.reduce((acc, o) => acc * o.total, 1) ?? 0 }))
        .toArray(),
    ).rejects.toThrow(/sum idiom/);
  });
});

describe("SQLite flatMap — SQL shapes", () => {
  it("compiles to an INNER JOIN that swaps to the child shape", async () => {
    const text = await sqlDb.users.flatMap((u) => u.orders).explain();
    expect(text).toMatch(
      /SELECT "t1"\.\* FROM "users" "t0" INNER JOIN "orders" "t1" ON \("t0"\."id" = "t1"\."user_id"\)/,
    );
  });

  it("a result selector projects across both sides", async () => {
    const text = await sqlDb.users
      .flatMap(
        (u) => u.orders,
        (u, o) => ({ who: u.name, total: o.total }),
      )
      .explain();
    expect(text).toContain('"t0"."name" AS "who"');
    expect(text).toContain('"t1"."total" AS "total"');
    expect(text).toContain("INNER JOIN");
  });

  it("chained flatMaps join through both navigations", async () => {
    // `sku` is unmapped, so it round-trips; raw rows otherwise carry physical
    // column names (see the identity-schema conformance corpus for full-row
    // equality against the reference).
    const sql = await sqlDb.users
      .flatMap((u) => u.orders)
      .flatMap((o) => o.items)
      .toArray();
    expect(sql.map((i) => i.sku).sort()).toEqual(["apple", "pear", "plum"]);
  });
});

describe("SQLite groupBy — SQL shape and edges", () => {
  it("groups by a column with aggregate projections", async () => {
    const text = await sqlDb.orders
      .groupBy((o) => o.userId)
      .map((g) => ({
        userId: g.key,
        n: g.items.length,
        total: g.items.reduce((acc, o) => acc + o.total, 0),
      }))
      .explain();
    expect(text).toContain('GROUP BY "t0"."user_id"');
    expect(text).toContain('CAST(COUNT(*) AS REAL) AS "n"');
    expect(text).toMatch(/CAST\(COALESCE\(SUM\("t0"\."total"\), 0\) AS REAL\)/);
  });

  it("filter after a group projection wraps around the GROUP BY (HAVING semantics)", async () => {
    const text = await sqlDb.orders
      .groupBy((o) => o.userId)
      .map((g) => ({ userId: g.key, n: g.items.length }))
      .filter((r) => r.n > 1)
      .explain();
    expect(text).toMatch(/FROM \(SELECT .*GROUP BY .*\) "d\d+" WHERE/);
  });

  it("precomputes a non-column group key into a derived table", async () => {
    const text = await sqlDb.users
      .groupBy((u) => u.orders?.length ?? 0)
      .map((g) => ({ orders: g.key, people: g.items.length }))
      .explain();
    expect(text).toMatch(/AS "__tql_g0" FROM "users"/);
    expect(text).toMatch(/GROUP BY "d\d+"\."__tql_g0"/);
  });

  it("rejects materializing raw groups and operators over a pending group", async () => {
    await expect(sqlDb.orders.groupBy((o) => o.userId).toArray()).rejects.toThrow(/memory-only/);
    await expect(
      sqlDb.orders
        .groupBy((o) => o.userId)
        .orderBy((g) => g.key)
        .toArray(),
    ).rejects.toThrow(/followed by a map/);
  });

  it("counts groups without a projection", async () => {
    expect(await sqlDb.orders.groupBy((o) => o.userId).count()).toBe(
      await memDb.orders.groupBy((o) => o.userId).count(),
    );
  });
});

describe("SQLite filtered includes — fetch shapes", () => {
  it("slices per parent with a ROW_NUMBER window and strips the marker", async () => {
    const statements: string[] = [];
    const recording: SqlExecutor = (text, values) => {
      statements.push(text);
      return executor(text, values);
    };
    const rdb = createContext<Schema>(sqlite(recording, schema), { relations });
    const rows = await rdb.users
      .include(
        (u) => u.orders,
        (q) => q.orderByDescending((o) => o.total).take(1),
      )
      .orderBy((u) => u.id)
      .take(3)
      .toArray();
    const fetch = statements.find((s) => s.includes("ROW_NUMBER"));
    expect(fetch).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY "t\d+"\."user_id" ORDER BY/);
    expect(fetch).toMatch(/"__tql_rn" > 0 AND .*"__tql_rn" <= 1/);
    // Ada keeps only her biggest order, and the marker never leaks.
    const ada = rows.find((u) => u.id === 1);
    expect(ada?.orders.map((o) => o.total)).toEqual([20]);
    expect(Object.keys(ada?.orders[0] ?? {})).not.toContain("__tql_rn");
  });

  it("refuses per-parent slices when the dialect disables window functions", async () => {
    const provider = makeSqlProvider(
      { ...sqliteDialect, windowFunctions: false },
      "sqlite-no-window",
      executor,
      schema,
    );
    const ndb = createContext<Schema>(provider, { relations });
    await expect(
      ndb.users
        .include(
          (u) => u.orders,
          (q) => q.orderBy((o) => o.id).take(1),
        )
        .toArray(),
    ).rejects.toThrow(/window functions/);
  });

  it("rejects a bare-row join projection with R2001", async () => {
    await expect(
      sqlDb.orders
        .join(
          sqlDb.users,
          (o) => o.userId,
          (u) => u.id,
          (o, u) => u,
        )
        .toArray(),
    ).rejects.toThrow(/R2001/);
  });

  it("rejects include inside a join inner plan with R2001", async () => {
    const inner = sqlDb.users.include((u) => u.orders);
    await expect(
      sqlDb.orders
        .join(
          inner,
          (o) => o.userId,
          (u) => u.id,
          (o, u) => ({ id: o.id, name: u.name }),
        )
        .toArray(),
    ).rejects.toThrow(/'include'/);
  });
});

describe("SQLite conformance corpus", () => {
  it("matches the reference on every default case", async () => {
    // Identity column names so full-row canonical comparison is meaningful;
    // SQLite stores booleans as 0/1, so the shared fixtures use 0/1 too.
    const fixtures: Fixtures = {
      users: users.map((u) => Object.assign({}, u, { active: u.active ? 1 : 0 })),
      orders,
      items,
    };
    const results = await runConformance(
      async (fx) => {
        const db = await openDb();
        db.run("CREATE TABLE users (id int, name text, age int, active int, city text);");
        db.run('CREATE TABLE orders (id int, "userId" int, total real);');
        db.run('CREATE TABLE items (id int, "orderId" int, sku text);');
        for (const u of fx.users as Array<Record<string, unknown>>) {
          db.run("INSERT INTO users VALUES (?,?,?,?,?)", [
            u.id,
            u.name,
            u.age,
            u.active,
            u.city,
          ] as unknown[]);
        }
        for (const o of fx.orders as Order[]) {
          db.run("INSERT INTO orders VALUES (?,?,?)", [o.id, o.userId, o.total]);
        }
        for (const i of fx.items as Item[]) {
          db.run("INSERT INTO items VALUES (?,?,?)", [i.id, i.orderId, i.sku]);
        }
        return sqlite(makeExecutor(db), {
          users: { table: "users" },
          orders: { table: "orders" },
          items: { table: "items" },
        });
      },
      { fixtures, relations: defaultRelations() },
    );
    const failures = results.filter((r) => !r.equal).map((r) => r.name);
    expect(failures).toEqual([]);
  });
});
