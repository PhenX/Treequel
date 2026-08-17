import { describe, expect, it } from "vitest";
import { b, isExpr, makeExpr, print } from "./index.js";

describe("makeExpr", () => {
  const body = b.binary(">", b.member(b.param("u"), "age"), b.const(18));

  it("brands a hand-built tree as an Expr with the given body", () => {
    const e = makeExpr(["u"], body);
    expect(isExpr(e)).toBe(true);
    expect(e.body).toBe(body);
    expect(e.params).toEqual(["u"]);
  });

  it("derives compiled from the interpreter over body", () => {
    const isAdult = makeExpr<(u: { age: number }) => boolean>(["u"], body);
    expect(isAdult.compiled({ age: 20 })).toBe(true);
    expect(isAdult.compiled({ age: 12 })).toBe(false);
  });

  it("reads captures from scope() at call time", () => {
    let min = 18;
    const overMin = makeExpr<(u: { age: number }) => boolean>(
      ["u"],
      b.binary(">", b.member(b.param("u"), "age"), b.capture("min")),
      { scope: () => ({ min }) },
    );
    expect(overMin.compiled({ age: 20 })).toBe(true);
    min = 21;
    expect(overMin.compiled({ age: 20 })).toBe(false);
  });

  it("uses an explicit compiled when provided", () => {
    const calls: number[] = [];
    const e = makeExpr<(u: { age: number }) => boolean>(["u"], body, {
      compiled: (u) => {
        calls.push(u.age);
        return u.age > 18;
      },
    });
    expect(e.compiled({ age: 30 })).toBe(true);
    expect(calls).toEqual([30]);
  });

  it("toString() prints the tree by default and honors src", () => {
    expect(String(makeExpr(["u"], body))).toBe(print(body));
    expect(String(makeExpr(["u"], body, { src: "u => u.age > 18" }))).toBe("u => u.age > 18");
  });
});
