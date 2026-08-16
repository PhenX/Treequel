import { describe, expect, it } from "vitest";
import {
  type SyncTransformHost,
  createRegistry,
  planModuleSync,
  scanModuleContexts,
  transformModule,
  transformModuleSync,
} from "./transform.js";

const CTX = [
  'import { createContext } from "@treequel/linq";',
  "const db = createContext(provider);",
];

describe("transformModuleSync — reification", () => {
  it("reifies a lambda at a traced where() call site", () => {
    const code = [...CTX, "const q = db.users.where(u => u.age > minAge);"].join("\n");
    const out = transformModuleSync(code, "src/q.ts");
    expect(out).not.toBeNull();
    expect(out!.count).toBe(1);
    expect(out!.code).toContain("compiled:u => u.age > minAge");
    expect(out!.code).toContain('import { __expr as __tql_expr$ } from "@treequel/core"');
    expect(out!.code).toContain('{kind:"Member",object:{kind:"Param",name:"u"},prop:"age"}');
    expect(out!.code).toContain("scope:()=>({minAge})");
  });

  it("reifies expr() calls regardless of taint", () => {
    const code = [
      'import { expr } from "@treequel/linq";',
      "const p = expr(u => u.age > 18);",
    ].join("\n");
    const out = transformModuleSync(code, "src/q.ts");
    expect(out!.count).toBe(1);
    expect(out!.code).toContain("__tql_expr$({v:1,compiled:u => u.age > 18");
  });

  it("is idempotent — a second pass is a no-op", () => {
    const code = [...CTX, "const q = db.users.where(u => u.age > minAge);"].join("\n");
    const first = transformModuleSync(code, "src/q.ts");
    expect(transformModuleSync(first!.code, "src/q.ts")).toBeNull();
  });

  it("reports subset diagnostics and leaves the offending lambda untouched", () => {
    const code = [...CTX, "const q = db.users.where(u => u.id == 1);"].join("\n");
    const out = transformModuleSync(code, "src/q.ts");
    expect(out).not.toBeNull();
    expect(out!.count).toBe(0);
    expect(out!.diagnostics.map((d) => d.code)).toContain("R1103");
    expect(out!.code).toBe(code);
  });

  it("bails on modules that reference no traced package", () => {
    expect(transformModuleSync("const x = arr.where(u => u.age > 1);")).toBeNull();
  });
});

describe("scanModuleContexts", () => {
  it("returns the names bound to createContext() results", () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "export const db = createContext(provider);",
      "export const other = createContext(another);",
    ].join("\n");
    expect(scanModuleContexts(code, "src/db.ts")).toEqual(["db", "other"]);
  });

  it("returns nothing for a module with no context", () => {
    const code = [
      'import { expr } from "@treequel/linq";',
      "export const p = expr(u => u.x);",
    ].join("\n");
    expect(scanModuleContexts(code, "src/q.ts")).toEqual([]);
  });
});

describe("transformModuleSync — cross-module contexts", () => {
  it("taints a context imported from another module via the registry", () => {
    const registry = createRegistry();
    const dbCode = [
      'import { createContext } from "@treequel/linq";',
      "export const db = createContext(provider);",
    ].join("\n");
    registry.contexts.set("/src/db.ts", new Set(scanModuleContexts(dbCode, "/src/db.ts")));

    // The query module mentions the traced package (a type import) so it clears
    // the pre-scan, then reaches its context through a relative import.
    const qCode = [
      'import type { Context } from "@treequel/linq";',
      'import { db } from "./db";',
      "const q = db.users.where(u => u.age > 1);",
    ].join("\n");
    const host: SyncTransformHost = {
      resolve: (source) => (source === "./db" ? "/src/db.ts" : null),
    };

    const out = transformModuleSync(qCode, "/src/q.ts", { registry }, host);
    expect(out).not.toBeNull();
    expect(out!.count).toBe(1);
    expect(out!.code).toContain("compiled:u => u.age > 1");
  });

  it("does not taint the import without a registry entry", () => {
    const qCode = [
      'import type { Context } from "@treequel/linq";',
      'import { db } from "./db";',
      "const q = db.users.where(u => u.age > 1);",
    ].join("\n");
    const host: SyncTransformHost = { resolve: () => "/src/db.ts" };
    // Empty registry → the import stays opaque → nothing reifies.
    const out = transformModuleSync(qCode, "/src/q.ts", { registry: createRegistry() }, host);
    expect(out).toBeNull();
  });
});

describe("planModuleSync", () => {
  it("edit-list reproduces the text transform when applied", () => {
    const code = [...CTX, "const q = db.users.where(u => u.age > minAge).select(u => u.id);"].join(
      "\n",
    );
    const plan = planModuleSync(code, "src/q.ts");
    const text = transformModuleSync(code, "src/q.ts");
    // Apply edits right-to-left so earlier offsets stay valid, then prepend the host import.
    let out = code;
    for (const e of [...plan!.edits].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }
    out = `import { __expr as __tql_expr$ } from "@treequel/core";\n${out}`;
    expect(out).toBe(text!.code);
    expect(plan!.count).toBe(text!.count);
  });

  it("returns null when nothing reifies", () => {
    expect(planModuleSync("const x = 1;")).toBeNull();
  });
});

describe("sync/async parity", () => {
  const cases = [
    "const q = db.users.where(u => u.age > minAge).select(u => u.id);",
    "const q = db.users.where(u => u.tags.some(t => t.startsWith(prefix)));",
    'import { expr } from "@treequel/linq";\nconst p = expr(u => u.age > 18);',
    "const q = db.users.include((u) => u.orders, (r) => r.where(o => o.total > 10).take(1));",
  ];
  for (const [i, snippet] of cases.entries()) {
    it(`produces byte-identical output to transformModule (case ${i})`, async () => {
      const code = snippet.startsWith("import") ? snippet : [...CTX, snippet].join("\n");
      const sync = transformModuleSync(code, "src/q.ts");
      const async_ = await transformModule(code, "src/q.ts");
      expect(sync?.code).toBe(async_?.code);
      expect(sync?.count).toBe(async_?.count);
    });
  }
});
