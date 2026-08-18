import { PGlite } from "@electric-sql/pglite";
import { type Context, createContext } from "@greffon/query";
import { memoryProvider } from "@greffon/provider-memory";
import { type SqlExecutor, postgres } from "@greffon/provider-postgres";
import { beforeAll, describe, expect, it } from "vitest";
import * as q from "./queries.js";
import { type Schema, orders, schemaMeta, users } from "./schema.js";

let memDb: Context<Schema>;
let pgDb: Context<Schema>;

beforeAll(async () => {
  const pg = await PGlite.create();
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
  const exec: SqlExecutor = (t, v) => pg.query(t, v) as ReturnType<SqlExecutor>;

  memDb = createContext<Schema>(memoryProvider({ users, orders }));
  pgDb = createContext<Schema>(postgres(exec, schemaMeta));
});

const multiset = (a: unknown[]): string[] => a.map((x) => JSON.stringify(x)).sort();

// The success criterion: the identical query definitions produce equal
// results in-memory and on Postgres.
describe("the same query file runs on memory and Postgres, equally", () => {
  it("activeAdults", async () => {
    expect(multiset(await q.activeAdults(pgDb))).toEqual(multiset(await q.activeAdults(memDb)));
  });

  it("oldestThreeNames (ordered)", async () => {
    expect(await q.oldestThreeNames(pgDb)).toEqual(await q.oldestThreeNames(memDb));
  });

  it("londoners (aggregate)", async () => {
    expect(await q.londoners(pgDb)).toBe(await q.londoners(memDb));
  });

  it("namesStartingWith — captured closure variable folds into the SQL", async () => {
    expect(multiset(await q.namesStartingWith(pgDb, "A"))).toEqual(
      multiset(await q.namesStartingWith(memDb, "A")),
    );
    expect((await q.namesStartingWith(pgDb, "A")).length).toBe(2); // Ada, Alan
  });
});
