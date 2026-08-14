import { expr } from "@treequel/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { enableFallback, parseFunctionSource } from "./index.js";

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  enableFallback();
});

describe("runtime fallback (toString capture)", () => {
  it("reifies a closure-free lambda when a provider reads the tree", () => {
    const e = expr((u: { age: number }) => u.age > 18);
    expect(e.params).toEqual(["u"]);
    const noSpans = JSON.parse(JSON.stringify(e.body, (k, v) => (k === "span" ? undefined : v)));
    expect(noSpans).toEqual({
      kind: "Binary",
      op: ">",
      left: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "age" },
      right: { kind: "Constant", value: 18 },
    });
    // compiled still runs regardless
    expect(e.compiled({ age: 20 })).toBe(true);
  });

  it("throws R3002 naming captured variables (closures can't be read via toString)", () => {
    const minAge = 18;
    const e = expr((u: { age: number }) => u.age > minAge);
    // compiled works (memory path), but reading the tree fails with a teachable error
    expect(e.compiled({ age: 20 })).toBe(true);
    expect(() => e.body).toThrowError(/R3002/);
    expect(() => e.body).toThrowError(/minAge/);
  });

  it("parses various function source forms", () => {
    expect(parseFunctionSource("u => u.active").body).toMatchObject({ kind: "Member", prop: "active" });
    expect(parseFunctionSource("(a, b) => a + b").params).toEqual(["a", "b"]);
    // A non-arrow function value is rejected (only arrow lambdas are supported).
    expect(parseFunctionSource("function (x) { return x.y; }").diagnostics.some((d) => d.code === "R1107")).toBe(
      true,
    );
  });

  it("reports subset violations through the shared catalog", () => {
    const r = parseFunctionSource("u => u.id == 1");
    expect(r.diagnostics.map((d) => d.code)).toContain("R1103");
  });
});
