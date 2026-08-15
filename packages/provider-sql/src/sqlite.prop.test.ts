import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { __expr, evaluate } from "@treequel/core";
import { createContext } from "@treequel/linq";
import { memoryProvider } from "@treequel/provider-memory";
import type { Node } from "@treequel/tree";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { type SchemaMeta, type SqlExecutor, sqliteProvider } from "./index.js";

const paramU: Node = { kind: "Param", name: "u" };
const col = (prop: string): Node => ({ kind: "Member", object: paramU, prop });
const int = (value: number): Node => ({ kind: "Constant", value });
const str = (value: string): Node => ({ kind: "Constant", value });

// Two-valued atoms only (no operand is ever NULL): `age`/`name`/`active` are
// non-null, and nullable `city` is only ever tested with IS [NOT] NULL. GLOB is
// case-sensitive and TEXT columns use the default BINARY collation, so string
// matching and ordering line up with the JS engine.
const arbAtom: fc.Arbitrary<Node> = fc.oneof(
  fc.record({
    kind: fc.constant("Binary" as const),
    op: fc.constantFrom(">", ">=", "<", "<=", "===", "!=="),
    left: fc.constant(col("age")),
    right: fc.integer({ min: 0, max: 80 }).map(int),
  }),
  fc.record({
    kind: fc.constant("Call" as const),
    callee: fc.record({
      kind: fc.constant("Member" as const),
      object: fc.constant(col("name")),
      prop: fc.constantFrom("startsWith", "endsWith", "includes"),
    }),
    args: fc.constantFrom("A", "a", "50%", "a_", "b", "").map((s) => [str(s)]),
  }),
  fc.constant(col("active")),
  fc.record({
    kind: fc.constant("Binary" as const),
    op: fc.constantFrom("===", "!=="),
    left: fc.constant(col("city")),
    right: fc.constant({ kind: "Constant" as const, value: null }),
  }),
);

const { p } = fc.letrec<{ p: Node }>((tie) => ({
  p: fc.oneof(
    { maxDepth: 3 },
    arbAtom,
    fc.record({
      kind: fc.constant("Logical" as const),
      op: fc.constantFrom("&&", "||"),
      left: tie("p"),
      right: tie("p"),
    }),
    fc.record({
      kind: fc.constant("Unary" as const),
      op: fc.constant("!" as const),
      operand: tie("p"),
    }),
  ),
}));

interface Row {
  id: number;
  age: number;
  name: string;
  active: boolean;
  city: string | null;
}

const arbRows: fc.Arbitrary<Row[]> = fc
  .array(
    fc.record({
      age: fc.integer({ min: 0, max: 80 }),
      name: fc.constantFrom("Ada", "Bob", "50%off", "a_b", "AL", "al", "", "b.x"),
      active: fc.boolean(),
      city: fc.option(fc.constantFrom("London", "NYC", "Paris"), { nil: null }),
    }),
    { maxLength: 8 },
  )
  .map((rows) => rows.map((r, i) => ({ id: i + 1, ...r })));

const schema: SchemaMeta = { users: { table: "users" } };

interface SqlJsDb {
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): {
    bind(params: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
}
let db: SqlJsDb;
let exec: SqlExecutor;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  db = new SQL.Database() as unknown as SqlJsDb;
  db.run("CREATE TABLE users (id int, age int, name text, active int, city text);");
  exec = (text, values) => {
    const stmt = db.prepare(text);
    stmt.bind(values);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return Promise.resolve({ rows });
  };
});

describe("SQLite provider ≡ memory reference (property, on sql.js)", () => {
  it("agrees on generated predicates over generated rows", async () => {
    await fc.assert(
      fc.asyncProperty(p, arbRows, async (tree, rows) => {
        const compiled = (row: Row): unknown => evaluate(tree, { params: { u: row } });
        const expr = __expr({
          v: 1,
          compiled: compiled as (...a: never[]) => unknown,
          params: ["u"],
          body: tree,
          scope: () => ({}),
        });

        const mem = (await createContext<{ users: Row }>(memoryProvider({ users: rows }))
          .users.where(expr)
          .toArray()) as Row[];

        db.run("DELETE FROM users");
        for (const r of rows) {
          db.run("INSERT INTO users VALUES (?,?,?,?,?)", [
            r.id,
            r.age,
            r.name,
            r.active ? 1 : 0,
            r.city,
          ]);
        }
        const sql = (await createContext<{ users: Row }>(sqliteProvider(exec, schema))
          .users.where(expr)
          .toArray()) as Row[];

        const ids = (rs: Row[]): number[] => rs.map((r) => r.id).sort((a, b) => a - b);
        expect(ids(sql)).toEqual(ids(mem));
      }),
      { numRuns: 40 },
    );
  }, 30_000);
});
