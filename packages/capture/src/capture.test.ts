import type { Node } from "@greffon/tree";
import { describe, expect, it } from "vitest";
import { adapterOxc } from "./adapter.js";
import { type CaptureResult, capture } from "./capture.js";
import { parseArrow } from "./test-util.js";

const cap = (src: string, opts?: Parameters<typeof capture>[2]): CaptureResult =>
  capture(parseArrow(src), adapterOxc, opts);

/** Strip spans so structural assertions stay readable. */
function stripSpans(n: Node): Node {
  const clone = JSON.parse(JSON.stringify(n, (k, v) => (k === "span" ? undefined : v))) as Node;
  return clone;
}

describe("capture — happy paths", () => {
  it("captures a param member vs a free variable", () => {
    const r = cap("u => u.age > minAge");
    expect(r.diagnostics).toHaveLength(0);
    expect(r.params).toEqual(["u"]);
    expect(r.freeVars).toEqual(["minAge"]);
    expect(stripSpans(r.body!)).toEqual({
      kind: "Binary",
      op: ">",
      left: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "age" },
      right: { kind: "Capture", name: "minAge" },
    });
  });

  it("captures method calls and multiple free vars in first-seen order", () => {
    const r = cap("u => u.age > minAge && u.name.startsWith(prefix)");
    expect(r.freeVars).toEqual(["minAge", "prefix"]);
    expect(r.body!.kind).toBe("Logical");
  });

  it("roots safelisted globals as global captures, not free vars", () => {
    const r = cap("u => Math.abs(u.balance) > 0");
    expect(r.freeVars).toEqual([]);
    const call = r.body as Extract<Node, { kind: "Binary" }>;
    const mathAbs = (call.left as Extract<Node, { kind: "Call" }>).callee as Extract<
      Node,
      { kind: "Member" }
    >;
    expect(mathAbs.object).toMatchObject({ kind: "Capture", name: "Math", global: true });
  });

  it("supports object-destructured params as Member on a synthetic root", () => {
    const r = cap("({ id, name }) => id === 1 && name.startsWith(prefix)");
    expect(r.params).toEqual(["$0"]);
    expect(r.freeVars).toEqual(["prefix"]);
    const left = (r.body as Extract<Node, { kind: "Logical" }>).left as Extract<
      Node,
      { kind: "Binary" }
    >;
    expect(stripSpans(left.left)).toEqual({
      kind: "Member",
      object: { kind: "Param", name: "$0" },
      prop: "id",
    });
  });

  it("strips TS-only syntax (as / satisfies / non-null / type-args)", () => {
    const r = cap("u => (u.meta as Meta).flag && u.token!.length > 0");
    expect(r.diagnostics).toHaveLength(0);
    const left = (r.body as Extract<Node, { kind: "Logical" }>).left;
    expect(stripSpans(left)).toEqual({
      kind: "Member",
      object: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "meta" },
      prop: "flag",
    });
  });

  it("captures nested lambdas with shadowing params", () => {
    const r = cap("u => u.tags.some(t => t.startsWith(prefix))");
    expect(r.freeVars).toEqual(["prefix"]);
    const some = r.body as Extract<Node, { kind: "Call" }>;
    const lambda = some.args[0] as Extract<Node, { kind: "Lambda" }>;
    expect(lambda.kind).toBe("Lambda");
    expect(lambda.params).toEqual(["t"]);
    // `t` inside resolves to a Param, not a Capture
    const inner = lambda.body as Extract<Node, { kind: "Call" }>;
    expect((inner.callee as Extract<Node, { kind: "Member" }>).object).toMatchObject({
      kind: "Param",
      name: "t",
    });
  });

  it("handles optional chaining, index access, templates, objects and ternaries", () => {
    expect(cap("u => u.a?.b").diagnostics).toHaveLength(0);
    expect(cap("u => u.items[0]").diagnostics).toHaveLength(0);
    expect(cap("u => `hi ${u.name}!`").diagnostics).toHaveLength(0);
    expect(cap("u => ({ id: u.id, ...u.rest })").diagnostics).toHaveLength(0);
    expect(cap("u => u.active ? 1 : 0").diagnostics).toHaveLength(0);
  });

  it("shadowing: a nested lambda param shadows an outer capture of the same name", () => {
    const r = cap("u => u.tags.some(prefix => prefix.length > 0)");
    // `prefix` is now the lambda param, so it is NOT a free variable
    expect(r.freeVars).toEqual([]);
  });
});

describe("capture — subset diagnostics (R11xx)", () => {
  const table: Array<[string, string]> = [
    ["R1103", "u => u.id == 1"],
    ["R1104", "u => this.x"],
    ["R1105", "u => new Date()"],
    ["R1106", "async u => await u.x"],
    ["R1108", "u => tag`x`"],
    ["R1110", "u => (u.a, u.b)"],
    ["R1102", "u => (u.x = 1)"],
    ["R1102", "u => u.x++"],
    ["R1111", "([a, b]) => a"],
    ["R1112", "(u = 1) => u"],
  ];

  for (const [code, src] of table) {
    it(`${src}  →  ${code}`, () => {
      const r = cap(src);
      expect(r.body).toBeNull();
      expect(r.diagnostics.map((d) => d.code)).toContain(code);
    });
  }

  it("rejects a block-bodied arrow with R1101", () => {
    const r = cap("u => { return u.age; }");
    expect(r.diagnostics.map((d) => d.code)).toContain("R1101");
    expect(r.body).toBeNull();
  });

  it("rejects a regex literal in the body with R1109", () => {
    const r = cap("u => /abc/.test(u.name)");
    expect(r.diagnostics.map((d) => d.code)).toContain("R1109");
  });

  it("attaches a source span to each diagnostic", () => {
    const r = cap("u => u.id == 1");
    const d = r.diagnostics.find((x) => x.code === "R1103");
    expect(d?.span).toBeDefined();
    expect(d!.span!.end).toBeGreaterThan(d!.span!.start);
  });
});
