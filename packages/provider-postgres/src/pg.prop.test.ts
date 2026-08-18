import { PGlite } from "@electric-sql/pglite";
import { __expr, evaluate } from "@greffon/core";
import { createContext } from "@greffon/query";
import { memoryProvider } from "@greffon/provider-memory";
import type { Node } from "@greffon/tree";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { type SchemaMeta, type SqlExecutor, postgres } from "./index.js";

const paramU: Node = { kind: "Param", name: "u" };
const col = (prop: string): Node => ({ kind: "Member", object: paramU, prop });
const int = (value: number): Node => ({ kind: "Constant", value });
const str = (value: string): Node => ({ kind: "Constant", value });

// Predicate atoms are all two-valued in SQL (no operand ever evaluates to NULL):
// `age`/`name`/`active` are NOT NULL, and the nullable `city` is only ever
// compared to null via IS [NOT] NULL. That keeps SQL and JS boolean logic aligned.
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
let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(
    `CREATE TABLE users (id int primary key, age int not null, name text not null COLLATE "C", active boolean not null, city text COLLATE "C");`,
  );
});

describe("SQL provider ≡ memory reference (property, on PGlite)", () => {
  it("agrees on generated predicates over generated rows", async () => {
    const exec: SqlExecutor = (t, v) => pg.query(t, v) as ReturnType<SqlExecutor>;
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
          .users.filter(expr)
          .toArray()) as Row[];

        await pg.query("DELETE FROM users");
        for (const r of rows) {
          await pg.query("INSERT INTO users VALUES ($1,$2,$3,$4,$5)", [
            r.id,
            r.age,
            r.name,
            r.active,
            r.city,
          ]);
        }
        const sql = (await createContext<{ users: Row }>(postgres(exec, schema))
          .users.filter(expr)
          .toArray()) as Row[];

        const ids = (rs: Row[]): number[] => rs.map((r) => r.id).sort((a, b) => a - b);
        expect(ids(sql)).toEqual(ids(mem));
      }),
      { numRuns: 40 },
    );
  }, 30_000);
});
