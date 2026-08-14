import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Node, deserialize, serialize } from "./index.js";

// Constant values spanning the JSON-native and tagged (Date/bigint/RegExp/…) sets.
const arbConst = fc.oneof(
  fc.integer(),
  fc.double({ min: -1e9, max: 1e9, noNaN: true }).filter((n) => !Object.is(n, -0)),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.bigInt(),
  fc.date({ min: new Date(0), max: new Date(4_000_000_000_000) }),
  fc.constant(/ab+c/gi),
);

const { node } = fc.letrec<{ node: Node }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    // leaves
    fc.record({ kind: fc.constant("Param" as const), name: fc.constantFrom("u", "x", "$0") }),
    fc.record({ kind: fc.constant("Capture" as const), name: fc.constantFrom("a", "b", "minAge") }),
    arbConst.map((value) => ({ kind: "Constant" as const, value })),
    // internal
    fc.record({
      kind: fc.constant("Binary" as const),
      op: fc.constantFrom("===", "!==", "<", "+", "*"),
      left: tie("node"),
      right: tie("node"),
    }),
    fc.record({
      kind: fc.constant("Logical" as const),
      op: fc.constantFrom("&&", "||", "??"),
      left: tie("node"),
      right: tie("node"),
    }),
    fc.record({
      kind: fc.constant("Unary" as const),
      op: fc.constantFrom("!", "-", "typeof"),
      operand: tie("node"),
    }),
    fc.record({
      kind: fc.constant("Ternary" as const),
      test: tie("node"),
      then: tie("node"),
      else: tie("node"),
    }),
    fc.record({
      kind: fc.constant("Member" as const),
      object: tie("node"),
      prop: fc.constantFrom("x", "y", "name"),
    }),
    fc.record({
      kind: fc.constant("Call" as const),
      callee: tie("node"),
      args: fc.array(tie("node"), { maxLength: 2 }),
    }),
    fc.record({
      kind: fc.constant("Template" as const),
      quasis: fc.array(fc.string(), { minLength: 1, maxLength: 3 }),
      exprs: fc.array(tie("node"), { maxLength: 2 }),
    }),
    fc.record({
      kind: fc.constant("ArrayLit" as const),
      elements: fc.array(tie("node"), { maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant("ObjectLit" as const),
      props: fc.array(fc.record({ key: fc.string(), value: tie("node") }), { maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant("In" as const),
      needle: tie("node"),
      haystack: tie("node"),
    }),
  ),
}));

describe("serialize / deserialize is identity (property)", () => {
  it("round-trips arbitrary trees through the JSON wire form", () => {
    fc.assert(
      fc.property(node, (tree) => {
        const wire = JSON.parse(JSON.stringify(serialize(tree)));
        expect(deserialize(wire)).toEqual(tree);
      }),
      { numRuns: 300 },
    );
  });

  it("is structuredClone-safe after serialize", () => {
    fc.assert(
      fc.property(node, (tree) => {
        expect(() => structuredClone(serialize(tree))).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
