import { PGlite } from "@electric-sql/pglite";
import { evaluate, partialEval, print } from "@treequel/core";
import { memoryProvider } from "@treequel/provider-memory";
import { type SqlExecutor, postgres } from "@treequel/provider-postgres";
import { type Context, createContext } from "@treequel/query";
import { deserialize, serialize } from "@treequel/tree";
import { beforeAll, describe, expect, it } from "vitest";
import { canSee } from "./policy.js";
import { type Schema, type Viewer, docs, schemaMeta } from "./schema.js";

let memDb: Context<Schema>;
let pgDb: Context<Schema>;

beforeAll(async () => {
  const pg = await PGlite.create();
  await pg.exec(
    `CREATE TABLE docs (id int primary key, org_id int, title text, archived boolean);`,
  );
  for (const d of docs) {
    await pg.query(`INSERT INTO docs VALUES ($1,$2,$3,$4)`, [d.id, d.orgId, d.title, d.archived]);
  }
  const exec: SqlExecutor = (t, v) => pg.query(t, v) as ReturnType<SqlExecutor>;

  memDb = createContext<Schema>(memoryProvider({ docs }));
  pgDb = createContext<Schema>(postgres(exec, schemaMeta));
});

const member: Viewer = { orgId: 1, role: "member" };
const admin: Viewer = { orgId: 1, role: "admin" };
const outsider: Viewer = { orgId: 2, role: "member" };

const idsFor = async (db: Context<Schema>, viewer: Viewer): Promise<number[]> =>
  (await db.docs.filter(canSee(viewer)).toArray()).map((d) => d.id).sort((a, b) => a - b);

describe("one rule, list filtering: the policy is the WHERE clause", () => {
  it("row-level filtering happens at the database, memory-equal", async () => {
    expect(await idsFor(pgDb, member)).toEqual([1]);
    expect(await idsFor(pgDb, admin)).toEqual([1, 2]);
    expect(await idsFor(pgDb, outsider)).toEqual([3]);
    for (const viewer of [member, admin, outsider]) {
      expect(await idsFor(pgDb, viewer)).toEqual(await idsFor(memDb, viewer));
    }
  });
});

describe("the same rule, one object: a can-this-viewer-see-this check", () => {
  it("compiled runs the original closure", () => {
    const rule = canSee(member);
    expect(rule.compiled(docs[0])).toBe(true); // own org, not archived
    expect(rule.compiled(docs[1])).toBe(false); // archived, not admin
  });

  it("evaluate needs no function at all once captures are folded", () => {
    const rule = canSee(admin);
    const folded = partialEval({ body: rule.body, scope: rule.scope });
    expect(evaluate(folded, { params: { d: docs[1] } })).toBe(true); // archived, but admin
    expect(evaluate(folded, { params: { d: docs[2] } })).toBe(false); // other org
  });
});

describe("the same rule, stored: an auditable artifact", () => {
  it("folds, serializes, round-trips, and prints for review", () => {
    const rule = canSee(member);
    const folded = partialEval({ body: rule.body, scope: rule.scope });

    // The stored form is self-contained JSON: captures are constants now.
    const stored = JSON.stringify(serialize(folded));
    const back = deserialize(JSON.parse(stored));
    expect(back).toEqual(folded);

    // Rehydrated, it still answers — the policy store needs no functions.
    expect(evaluate(back, { params: { d: docs[0] } })).toBe(true);

    // And it renders readably for a review UI or an audit log.
    const rendered = print(folded);
    expect(rendered).toContain("orgId");
    expect(rendered).toContain("archived");
  });
});
