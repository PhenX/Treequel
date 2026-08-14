import type { Node } from "@treequel/tree";
import { describe, expect, it } from "vitest";
import {
  __expr,
  b,
  children,
  evaluate,
  expr,
  foldConstants,
  isClosed,
  isExpr,
  partialEval,
  print,
  rewrite,
  visit,
} from "./index.js";

describe("visitor primitives", () => {
  it("children lists sub-nodes in evaluation order", () => {
    const call = b.method(b.param("u"), "startsWith", [b.const("a")]);
    // Call callee is Member(u, startsWith); children = [callee, ...args]
    expect(children(call).map((c) => c.kind)).toEqual(["Member", "Constant"]);
  });

  it("visit walks every node pre-order", () => {
    const tree = b.binary(">", b.member(b.param("u"), "age"), b.const(18));
    const kinds: string[] = [];
    visit(tree, {
      Binary: (n) => kinds.push(`Binary:${n.op}`),
      Param: (n) => kinds.push(`Param:${n.name}`),
      Constant: (n) => kinds.push(`Constant:${String(n.value)}`),
    });
    expect(kinds).toEqual(["Binary:>", "Param:u", "Constant:18"]);
  });

  it("rewrite shares structure when nothing changes", () => {
    const tree = b.binary(">", b.member(b.param("u"), "age"), b.const(18));
    const out = rewrite(tree, { Param: () => undefined });
    expect(out).toBe(tree);
  });

  it("rewrite replaces matched nodes bottom-up", () => {
    const tree = b.binary("+", b.const(1), b.const(2));
    const out = rewrite(tree, {
      Constant: (n) => b.const((n.value as number) * 10),
    });
    expect(out).toEqual(b.binary("+", b.const(10), b.const(20)));
    expect(out).not.toBe(tree);
  });
});

describe("evaluate", () => {
  const env = {
    params: { u: { age: 20, name: "ada", tags: ["x", "ab"] } },
    scope: { minAge: 18, prefix: "a" },
  };

  it("evaluates a captured predicate", () => {
    const tree = b.logical(
      "&&",
      b.binary(">", b.member(b.param("u"), "age"), b.capture("minAge")),
      b.method(b.member(b.param("u"), "name"), "startsWith", [b.capture("prefix")]),
    );
    expect(evaluate(tree, env)).toBe(true);
  });

  it("resolves global captures from the realm", () => {
    const tree = b.method(b.capture("Math", true), "abs", [b.const(-5)]);
    expect(evaluate(tree)).toBe(5);
  });

  it("handles optional chaining", () => {
    const tree = b.member(b.member(b.param("u"), "missing", true), "deep", true);
    expect(evaluate(tree, { params: { u: {} } })).toBeUndefined();
  });

  it("evaluates nested lambdas (some)", () => {
    const tree = b.method(b.member(b.param("u"), "tags"), "some", [
      b.lambda(["t"], b.method(b.param("t"), "startsWith", [b.capture("prefix")])),
    ]);
    expect(evaluate(tree, env)).toBe(true);
  });

  it("evaluates templates, objects and arrays", () => {
    expect(evaluate(b.template(["Hi ", "!"], [b.member(b.param("u"), "name")]), env)).toBe(
      "Hi ada!",
    );
    expect(evaluate(b.object([{ key: "n", value: b.member(b.param("u"), "name") }]), env)).toEqual({
      n: "ada",
    });
    expect(evaluate(b.array([b.const(1), { spread: b.const([2, 3]) }]))).toEqual([1, 2, 3]);
  });
});

describe("partial evaluation", () => {
  it("isClosed distinguishes param-rooted from closed subtrees", () => {
    expect(isClosed(b.binary("+", b.capture("a"), b.const(1)))).toBe(true);
    expect(isClosed(b.member(b.param("u"), "age"))).toBe(false);
  });

  it("folds closed captured subtrees to constants", () => {
    const tree = b.binary(
      ">",
      b.member(b.param("u"), "age"),
      b.binary("+", b.capture("minAge"), b.const(1)),
    );
    const folded = foldConstants(tree, { minAge: 17 });
    expect(folded).toEqual(b.binary(">", b.member(b.param("u"), "age"), b.const(18)));
  });

  it("never folds a Lambda to a value, but folds inside it", () => {
    const tree = b.method(b.member(b.param("u"), "tags"), "some", [
      b.lambda(["t"], b.method(b.param("t"), "startsWith", [b.capture("prefix")])),
    ]);
    const folded = partialEval({ body: tree, scope: () => ({ prefix: "a" }) });
    // structure preserved; only the capture inside the lambda becomes a constant
    const lambda = (folded as Extract<Node, { kind: "Call" }>).args[0] as Extract<
      Node,
      { kind: "Lambda" }
    >;
    expect(lambda.kind).toBe("Lambda");
    const inner = lambda.body as Extract<Node, { kind: "Call" }>;
    expect(inner.args[0]).toEqual(b.const("a"));
  });

  it("property: evaluate(partialEval(t)) === evaluate(t) for random params", () => {
    const tree = b.logical(
      "&&",
      b.binary(">", b.member(b.param("u"), "age"), b.binary("+", b.capture("minAge"), b.const(2))),
      b.binary("<", b.member(b.param("u"), "age"), b.capture("maxAge")),
    );
    const scope = { minAge: 18, maxAge: 65 };
    const folded = partialEval({ body: tree, scope: () => scope });
    for (let i = 0; i < 50; i++) {
      const age = Math.floor(Math.random() * 100);
      const env = { params: { u: { age } }, scope };
      expect(evaluate(folded, env)).toBe(evaluate(tree, env));
    }
  });
});

describe("Expr host", () => {
  it("__expr brands, freezes and preserves compiled", () => {
    const compiled = (u: { age: number }): boolean => u.age > 18;
    const e = __expr({
      v: 1,
      compiled,
      params: ["u"],
      body: b.binary(">", b.member(b.param("u"), "age"), b.const(18)),
      scope: () => ({}),
      src: "u => u.age > 18",
    });
    expect(isExpr(e)).toBe(true);
    expect(Object.isFrozen(e)).toBe(true);
    expect(e.compiled({ age: 20 })).toBe(true);
    expect(String(e)).toBe("u => u.age > 18");
  });

  it("__expr rejects a mismatched format version (R1901)", () => {
    expect(() =>
      __expr({ v: 999, compiled: () => true, params: [], body: b.const(true), scope: () => ({}) }),
    ).toThrowError(/R1901/);
  });

  it("isExpr rejects plain objects and functions", () => {
    expect(isExpr({ body: {}, compiled: () => 1 })).toBe(false);
    expect(isExpr(() => 1)).toBe(false);
  });

  it("expr() without a fallback host throws a teachable error when the tree is read", () => {
    const e = expr((u: { age: number }) => u.age > 18);
    // compiled is always available (memory provider path)
    expect(e.compiled({ age: 20 })).toBe(true);
    // reading body triggers the fallback, which is not registered here
    expect(() => e.body).toThrowError(/R3001/);
  });
});

describe("printer", () => {
  it("prints a readable predicate", () => {
    const tree = b.logical(
      "&&",
      b.binary(">", b.member(b.param("u"), "age"), b.capture("minAge")),
      b.method(b.member(b.param("u"), "name"), "startsWith", [b.const("A")]),
    );
    expect(print(tree)).toBe('((u.age > minAge) && u.name.startsWith("A"))');
  });
});
