import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createTransformerFactory } from "./index.js";
import type { TreequelTransformerOptions } from "./index.js";

/**
 * Compile a set of virtual files through a real `ts.Program`, running the
 * Treequel transformer as a `before` transformer during emit. Returns the
 * emitted `.js` text per input file. This exercises the whole path: our splice,
 * the re-parse, then TypeScript's own type-stripping and module lowering.
 */
function compile(
  files: Record<string, string>,
  options: TreequelTransformerOptions = {},
  compilerOptions: ts.CompilerOptions = {},
): Record<string, string> {
  const opts: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    ...compilerOptions,
  };
  const sources = new Map(
    Object.entries(files).map(([name, code]) => [
      name,
      ts.createSourceFile(name, code, opts.target ?? ts.ScriptTarget.ES2022, true),
    ]),
  );
  const outputs: Record<string, string> = {};
  const base = ts.createCompilerHost(opts);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (name, lv, onErr) => sources.get(name) ?? base.getSourceFile(name, lv, onErr),
    fileExists: (name) => sources.has(name) || base.fileExists(name),
    readFile: (name) => files[name] ?? base.readFile(name),
    writeFile: (name, text) => {
      outputs[name] = text;
    },
  };

  const program = ts.createProgram(Object.keys(files), opts, host);
  program.emit(undefined, undefined, undefined, false, {
    before: [createTransformerFactory(program, options)],
  });
  return outputs;
}

describe("ts transformer — emit", () => {
  it("reifies a lambda at a traced filter() call site", () => {
    const js = compile({
      "/q.ts": [
        'import { createContext } from "@treequel/query";',
        "const db = createContext(provider);",
        "export const q = db.users.filter((u) => u.age > minAge);",
      ].join("\n"),
    })["/q.js"];

    expect(js).toContain("__tql_expr$");
    expect(js).toContain("v: 1");
    // the original lambda is preserved as `compiled`, the tree body is inlined
    expect(js).toContain("compiled:");
    expect(js).toContain('"Member"');
    expect(js).toContain('import { __expr as __tql_expr$ } from "@treequel/core"');
  });

  it("strips the type annotations around a reified lambda", () => {
    const js = compile({
      "/q.ts": [
        'import { createContext } from "@treequel/query";',
        "interface User { age: number }",
        "const db = createContext(provider);",
        "export const q = db.users.filter((u: User): boolean => u.age > 18);",
      ].join("\n"),
    })["/q.js"];

    expect(js).toContain("__tql_expr$");
    // the User interface and the annotations are gone from the emit
    expect(js).not.toContain("interface User");
    expect(js).not.toContain(": boolean");
  });

  it("reifies expr() wrappers without a context", () => {
    const js = compile({
      "/q.ts": [
        'import { expr } from "@treequel/query";',
        "export const p = expr((u) => u.age > 18);",
      ].join("\n"),
    })["/q.js"];

    expect(js).toContain("__tql_expr$");
    expect(js).toContain('"Binary"');
  });

  it("resolves a context imported from another module", () => {
    const outputs = compile({
      "/db.ts": [
        'import { createContext } from "@treequel/query";',
        "export const db = createContext(provider);",
      ].join("\n"),
      "/q.ts": [
        'import type { Context } from "@treequel/query";',
        'import { db } from "./db.js";',
        "export const q = db.users.filter((u) => u.active);",
      ].join("\n"),
    });

    expect(outputs["/q.js"]).toContain("__tql_expr$");
    expect(outputs["/q.js"]).toContain('"Member"');
  });

  it("is idempotent — running twice changes nothing more", () => {
    const src = [
      'import { createContext } from "@treequel/query";',
      "const db = createContext(provider);",
      "export const q = db.users.filter((u) => u.age > 1);",
    ].join("\n");

    const once = compile({ "/q.ts": src })["/q.js"];
    // Feed the emitted code back through a second transform pass.
    const twice = compile({ "/q.ts": once }, {}, { module: ts.ModuleKind.ESNext })["/q.js"];

    const count = (s: string): number => s.split("__tql_expr$({").length - 1;
    expect(count(once)).toBe(1);
    expect(count(twice)).toBe(1);
  });

  it("leaves modules without traced query lambdas untouched", () => {
    const src = "export const x = [1, 2, 3].filter((n) => n > 1);";
    const js = compile({ "/plain.ts": src })["/plain.js"];
    expect(js).not.toContain("__tql_expr$");
  });

  it("does not reify a lambda that violates the subset (silent mode)", () => {
    const js = compile(
      {
        "/q.ts": [
          'import { createContext } from "@treequel/query";',
          "const db = createContext(provider);",
          "export const q = db.users.filter((u) => u.id == 1);",
        ].join("\n"),
      },
      { diagnostics: "silent" },
    )["/q.js"];

    // Loose equality is rejected at capture time; the lambda is left as-is.
    expect(js).not.toContain("__tql_expr$");
    expect(js).toContain("u.id == 1");
  });

  it("refuses CommonJS output rather than emit an unbound host reference", () => {
    expect(() =>
      compile(
        {
          "/q.ts": [
            'import { createContext } from "@treequel/query";',
            "const db = createContext(provider);",
            "export const q = db.users.filter((u) => u.age > 1);",
          ].join("\n"),
        },
        {},
        { module: ts.ModuleKind.CommonJS },
      ),
    ).toThrow(/ES module output/);
  });

  it("throws in error mode when a lambda violates the subset", () => {
    expect(() =>
      compile(
        {
          "/q.ts": [
            'import { createContext } from "@treequel/query";',
            "const db = createContext(provider);",
            "export const q = db.users.filter((u) => u.id == 1);",
          ].join("\n"),
        },
        { diagnostics: "error" },
      ),
    ).toThrow(/R1103/);
  });
});

describe("ts transformer — single-file transform (no program)", () => {
  const printed = (code: string, options: TreequelTransformerOptions = {}): string => {
    const sf = ts.createSourceFile("/q.ts", code, ts.ScriptTarget.ES2022, true);
    const result = ts.transform(sf, [createTransformerFactory(undefined, options)]);
    const out = ts.createPrinter().printFile(result.transformed[0]);
    result.dispose();
    return out;
  };

  it("reifies expr() with no program supplied", () => {
    const out = printed(
      ['import { expr } from "@treequel/query";', "const p = expr((u) => u.age > 18);"].join("\n"),
    );
    expect(out).toContain("__tql_expr$");
  });

  it("returns matching files unchanged when nothing reifies", () => {
    const out = printed("const x = plain.filter((n) => n > 1);");
    expect(out).not.toContain("__tql_expr$");
  });
});
