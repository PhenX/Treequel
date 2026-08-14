import { describe, expect, it } from "vitest";
import { type Node, deserialize, isNode, isSpread, serialize } from "./index.js";
import { FORMAT_VERSION } from "./version.js";

const roundTrip = (n: Node): Node => deserialize(serialize(n));

describe("serialize / deserialize", () => {
  it("round-trips a simple predicate tree", () => {
    const tree: Node = {
      kind: "Binary",
      op: ">",
      left: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "age" },
      right: { kind: "Capture", name: "minAge" },
    };
    expect(roundTrip(tree)).toEqual(tree);
  });

  it("emits the format version in the envelope", () => {
    const json = serialize({ kind: "Param", name: "u" });
    expect(json.v).toBe(FORMAT_VERSION);
    expect(json.root).toEqual({ kind: "Param" as const, name: "u" });
  });

  it("strips spans by default and keeps them with keepSpans", () => {
    const withSpan: Node = { kind: "Param", name: "u", span: { start: 0, end: 1 } };
    expect(serialize(withSpan).root).not.toHaveProperty("span");
    expect((serialize(withSpan, { keepSpans: true }).root as Node).span).toEqual({
      start: 0,
      end: 1,
    });
  });

  it("is structuredClone-safe after serialize", () => {
    const tree: Node = {
      kind: "Constant",
      value: { nested: [1, 2, 3], flag: true },
    };
    expect(() => structuredClone(serialize(tree))).not.toThrow();
  });

  describe("Constant value codec", () => {
    const cases: Array<[string, unknown]> = [
      ["string", "hello"],
      ["number", 42],
      ["boolean", true],
      ["null", null],
      ["undefined", undefined],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["bigint", 123456789012345678901234567890n],
      ["array", [1, "two", false, null]],
      ["nested object", { a: 1, b: { c: [true, null] } }],
    ];

    for (const [name, value] of cases) {
      it(`round-trips ${name}`, () => {
        const out = roundTrip({ kind: "Constant", value }) as Node & { value: unknown };
        expect(out.value).toEqual(value);
      });
    }

    it("round-trips a Date to an equal Date", () => {
      const d = new Date("2026-08-14T12:00:00.000Z");
      const out = roundTrip({ kind: "Constant", value: d }) as Node & { value: Date };
      expect(out.value).toBeInstanceOf(Date);
      expect(out.value.getTime()).toBe(d.getTime());
    });

    it("round-trips a RegExp to an equal RegExp", () => {
      const re = /ab+c/gi;
      const out = roundTrip({ kind: "Constant", value: re }) as Node & { value: RegExp };
      expect(out.value).toBeInstanceOf(RegExp);
      expect(out.value.source).toBe("ab+c");
      expect(out.value.flags).toBe("gi");
    });

    it("round-trips a Date nested inside an array constant", () => {
      const d = new Date("2020-01-01T00:00:00.000Z");
      const out = roundTrip({ kind: "Constant", value: [d, "x"] }) as Node & { value: unknown[] };
      expect((out.value[0] as Date).getTime()).toBe(d.getTime());
    });

    it("refuses to serialize a function constant (R1901)", () => {
      expect(() => serialize({ kind: "Constant", value: () => 1 })).toThrowError(/R1901/);
    });
  });

  describe("deserialize validation", () => {
    it("rejects a non-envelope (R1901)", () => {
      expect(() => deserialize({ nope: true })).toThrowError(/R1901/);
    });

    it("rejects a newer major format (R1901)", () => {
      expect(() => deserialize({ v: FORMAT_VERSION + 1, root: { kind: "Param", name: "u" } })).toThrowError(
        /newer/,
      );
    });

    it("rejects an unknown node kind (R1901)", () => {
      expect(() => deserialize({ v: 1, root: { kind: "Wat" } })).toThrowError(/Unknown node kind/);
    });
  });

  it("preserves the full node algebra through a round-trip", () => {
    const tree: Node = {
      kind: "Logical",
      op: "&&",
      left: {
        kind: "Call",
        callee: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "startsWith" },
        args: [{ kind: "Constant", value: "a" }],
      },
      right: {
        kind: "Ternary",
        test: { kind: "Unary", op: "!", operand: { kind: "Capture", name: "flag" } },
        then: {
          kind: "ObjectLit",
          props: [
            { key: "x", value: { kind: "Constant", value: 1 } },
            { spread: { kind: "Capture", name: "rest" } },
          ],
        },
        else: {
          kind: "ArrayLit",
          elements: [
            { kind: "Constant", value: 2 },
            { spread: { kind: "Capture", name: "more" } },
          ],
        },
      },
    };
    expect(roundTrip(tree)).toEqual(tree);
  });
});

describe("node guards", () => {
  it("isNode accepts real nodes and rejects junk", () => {
    expect(isNode({ kind: "Param", name: "u" })).toBe(true);
    expect(isNode({ kind: "NotAKind" })).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isNode("Param")).toBe(false);
  });

  it("isSpread discriminates spreads", () => {
    expect(isSpread({ spread: { kind: "Param", name: "u" } })).toBe(true);
    expect(isSpread({ key: "x", value: { kind: "Param", name: "u" } })).toBe(false);
  });
});
