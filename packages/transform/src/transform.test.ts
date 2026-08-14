import { describe, expect, it } from "vitest";
import { transformModule } from "./transform.js";

const run = (code: string, id = "src/q.ts", opts = {}) => transformModule(code, id, opts);

describe("transformModule — reification", () => {
  it("reifies a lambda at a traced where() call site", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.age > minAge);",
    ].join("\n");
    const out = await run(code);
    expect(out).not.toBeNull();
    expect(out!.count).toBe(1);
    // original lambda preserved as compiled
    expect(out!.code).toContain("compiled:u => u.age > minAge");
    // host + import injected
    expect(out!.code).toContain('import { __expr as __tql_expr$ } from "@treequel/core"');
    expect(out!.code).toContain("__tql_expr$({v:1,compiled:");
    // tree body + scope thunk
    expect(out!.code).toContain('{kind:"Member",object:{kind:"Param",name:"u"},prop:"age"}');
    expect(out!.code).toContain("scope:()=>({minAge})");
    expect(out!.code).toContain('params:["u"]');
  });

  it("skips modules that reference no traced package", async () => {
    expect(await run("const x = arr.where(u => u.age > 1);")).toBeNull();
  });

  it("does not reify lambdas on untainted receivers", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const other = [].filter(x => x > 1);", // not tainted
    ].join("\n");
    // db is created but never used in a query; `.filter` on [] is not tainted → no reify
    expect(await run(code)).toBeNull();
  });

  it("taints intermediate bindings across the fixpoint", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const base = db.users;",
      "const q = base.where(u => u.active).select(u => u.id);",
    ].join("\n");
    const out = await run(code);
    expect(out!.count).toBe(2);
  });

  it("reifies expr() calls regardless of taint", async () => {
    const code = ['import { expr } from "@treequel/linq";', "const p = expr(u => u.age > 18);"].join("\n");
    const out = await run(code);
    expect(out!.count).toBe(1);
    expect(out!.code).toContain("__tql_expr$({v:1,compiled:u => u.age > 18");
  });

  it("handles nested lambdas as a single reified unit", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.tags.some(t => t.startsWith(prefix)));",
    ].join("\n");
    const out = await run(code);
    expect(out!.count).toBe(1); // outer only; nested some() lambda is inside the tree
    expect(out!.code).toContain('{kind:"Lambda",params:["t"]');
  });

  it("reports subset diagnostics and leaves the offending lambda untouched", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.id == 1);",
    ].join("\n");
    const out = await run(code);
    // A result is returned so the plugin can surface diagnostics, but nothing is reified.
    expect(out).not.toBeNull();
    expect(out!.count).toBe(0);
    expect(out!.diagnostics.map((d) => d.code)).toContain("R1103");
    expect(out!.code).toBe(code); // source unchanged, no host import injected
  });

  it("is idempotent — a second pass is a no-op", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.age > minAge);",
    ].join("\n");
    const first = await run(code);
    const second = await run(first!.code, "src/q.ts");
    expect(second).toBeNull();
  });

  it("emits a source loc and, by default, the original src", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.age > 1);",
    ].join("\n");
    const out = await run(code);
    expect(out!.code).toMatch(/loc:"src\/q\.ts:3:\d+"/);
    expect(out!.code).toContain('src:"u => u.age > 1"');
  });

  it("omits src when emitSource is false", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.age > 1);",
    ].join("\n");
    const out = await transformModule(code, "src/q.ts", { emitSource: false });
    expect(out!.code).not.toContain('src:"u');
  });

  it("produces a sourcemap", async () => {
    const code = [
      'import { createContext } from "@treequel/linq";',
      "const db = createContext(provider);",
      "const q = db.users.where(u => u.age > 1);",
    ].join("\n");
    const out = await run(code);
    expect(out!.map.mappings.length).toBeGreaterThan(0);
  });
});
