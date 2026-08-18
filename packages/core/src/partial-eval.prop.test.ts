import type { Node } from "@greffon/tree";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluate, partialEval } from "./index.js";

// Numeric/boolean expressions over the row param `u` and a fixed capture scope.
const SCOPE = { a: 3, b: 7, c: -2 };

const { e } = fc.letrec<{ e: Node }>((tie) => ({
  e: fc.oneof(
    { maxDepth: 4 },
    fc.constant({ kind: "Param" as const, name: "u" }),
    fc.constantFrom("a", "b", "c").map((name) => ({ kind: "Capture" as const, name })),
    fc.integer({ min: -50, max: 50 }).map((value) => ({ kind: "Constant" as const, value })),
    fc.record({
      kind: fc.constant("Binary" as const),
      op: fc.constantFrom("+", "-", "*", ">", "<", ">=", "<=", "===", "!=="),
      left: tie("e"),
      right: tie("e"),
    }),
    fc.record({
      kind: fc.constant("Logical" as const),
      op: fc.constantFrom("&&", "||", "??"),
      left: tie("e"),
      right: tie("e"),
    }),
    fc.record({
      kind: fc.constant("Unary" as const),
      op: fc.constantFrom("-", "!"),
      operand: tie("e"),
    }),
    fc.record({
      kind: fc.constant("Ternary" as const),
      test: tie("e"),
      then: tie("e"),
      else: tie("e"),
    }),
  ),
}));

const eq = (a: unknown, b: unknown): boolean => a === b || Object.is(a, b);

describe("partial evaluation preserves semantics (property)", () => {
  it("evaluate(partialEval(t)) === evaluate(t) for random row inputs", () => {
    fc.assert(
      fc.property(e, fc.integer({ min: -100, max: 100 }), (tree, u) => {
        const folded = partialEval({ body: tree, scope: () => SCOPE });
        const env = { params: { u }, scope: SCOPE };
        expect(eq(evaluate(folded, env), evaluate(tree, env))).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("folding is idempotent", () => {
    fc.assert(
      fc.property(e, (tree) => {
        const once = partialEval({ body: tree, scope: () => SCOPE });
        const twice = partialEval({ body: once, scope: () => SCOPE });
        const env = { params: { u: 5 }, scope: SCOPE };
        expect(eq(evaluate(once, env), evaluate(twice, env))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
