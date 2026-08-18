import { FORMAT_VERSION } from "./version.js";

/**
 * JSON Schema (draft 2020-12) for the *serialized* tree wire format — the
 * `{ v, root }` envelope produced by {@link serialize}. Documents the format
 * for non-TS consumers (a Go/.NET server rehydrating a remote query) and backs
 * the fuzz tests.
 */
export const treeJsonSchema: Readonly<Record<string, unknown>> = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://greffon.dev/tree.schema.json",
  title: "Greffon expression tree",
  type: "object",
  required: ["v", "root"],
  properties: {
    v: { type: "integer", minimum: 1, maximum: FORMAT_VERSION },
    root: { $ref: "#/$defs/Node" },
  },
  $defs: {
    Node: {
      oneOf: [
        { $ref: "#/$defs/Param" },
        { $ref: "#/$defs/Capture" },
        { $ref: "#/$defs/Constant" },
        { $ref: "#/$defs/Member" },
        { $ref: "#/$defs/Index" },
        { $ref: "#/$defs/Call" },
        { $ref: "#/$defs/Binary" },
        { $ref: "#/$defs/Logical" },
        { $ref: "#/$defs/Unary" },
        { $ref: "#/$defs/Ternary" },
        { $ref: "#/$defs/Template" },
        { $ref: "#/$defs/ObjectLit" },
        { $ref: "#/$defs/ArrayLit" },
        { $ref: "#/$defs/Lambda" },
        { $ref: "#/$defs/In" },
      ],
    },
    Span: {
      type: "object",
      required: ["start", "end"],
      properties: { start: { type: "integer" }, end: { type: "integer" } },
    },
    Param: {
      type: "object",
      required: ["kind", "name"],
      properties: { kind: { const: "Param" }, name: { type: "string" } },
    },
    Capture: {
      type: "object",
      required: ["kind", "name"],
      properties: {
        kind: { const: "Capture" },
        name: { type: "string" },
        global: { const: true },
      },
    },
    Constant: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { const: "Constant" },
        value: {},
        type: { enum: ["date", "bigint", "regexp", "undefined", "number"] },
      },
    },
    Member: {
      type: "object",
      required: ["kind", "object", "prop"],
      properties: {
        kind: { const: "Member" },
        object: { $ref: "#/$defs/Node" },
        prop: { type: "string" },
        optional: { const: true },
      },
    },
    Index: {
      type: "object",
      required: ["kind", "object", "index"],
      properties: {
        kind: { const: "Index" },
        object: { $ref: "#/$defs/Node" },
        index: { $ref: "#/$defs/Node" },
        optional: { const: true },
      },
    },
    Call: {
      type: "object",
      required: ["kind", "callee", "args"],
      properties: {
        kind: { const: "Call" },
        callee: { $ref: "#/$defs/Node" },
        args: { type: "array", items: { $ref: "#/$defs/Node" } },
        optional: { const: true },
      },
    },
    Binary: {
      type: "object",
      required: ["kind", "op", "left", "right"],
      properties: {
        kind: { const: "Binary" },
        op: {
          enum: [
            "===",
            "!==",
            "<",
            "<=",
            ">",
            ">=",
            "+",
            "-",
            "*",
            "/",
            "%",
            "**",
            "instanceof",
            "in",
          ],
        },
        left: { $ref: "#/$defs/Node" },
        right: { $ref: "#/$defs/Node" },
      },
    },
    Logical: {
      type: "object",
      required: ["kind", "op", "left", "right"],
      properties: {
        kind: { const: "Logical" },
        op: { enum: ["&&", "||", "??"] },
        left: { $ref: "#/$defs/Node" },
        right: { $ref: "#/$defs/Node" },
      },
    },
    Unary: {
      type: "object",
      required: ["kind", "op", "operand"],
      properties: {
        kind: { const: "Unary" },
        op: { enum: ["!", "-", "+", "typeof"] },
        operand: { $ref: "#/$defs/Node" },
      },
    },
    Ternary: {
      type: "object",
      required: ["kind", "test", "then", "else"],
      properties: {
        kind: { const: "Ternary" },
        test: { $ref: "#/$defs/Node" },
        then: { $ref: "#/$defs/Node" },
        else: { $ref: "#/$defs/Node" },
      },
    },
    Template: {
      type: "object",
      required: ["kind", "quasis", "exprs"],
      properties: {
        kind: { const: "Template" },
        quasis: { type: "array", items: { type: "string" } },
        exprs: { type: "array", items: { $ref: "#/$defs/Node" } },
      },
    },
    ObjectLit: {
      type: "object",
      required: ["kind", "props"],
      properties: {
        kind: { const: "ObjectLit" },
        props: {
          type: "array",
          items: {
            oneOf: [
              {
                type: "object",
                required: ["key", "value"],
                properties: { key: { type: "string" }, value: { $ref: "#/$defs/Node" } },
              },
              {
                type: "object",
                required: ["spread"],
                properties: { spread: { $ref: "#/$defs/Node" } },
              },
            ],
          },
        },
      },
    },
    ArrayLit: {
      type: "object",
      required: ["kind", "elements"],
      properties: {
        kind: { const: "ArrayLit" },
        elements: {
          type: "array",
          items: {
            oneOf: [
              { $ref: "#/$defs/Node" },
              {
                type: "object",
                required: ["spread"],
                properties: { spread: { $ref: "#/$defs/Node" } },
              },
            ],
          },
        },
      },
    },
    Lambda: {
      type: "object",
      required: ["kind", "params", "body"],
      properties: {
        kind: { const: "Lambda" },
        params: { type: "array", items: { type: "string" } },
        body: { $ref: "#/$defs/Node" },
      },
    },
    In: {
      type: "object",
      required: ["kind", "needle", "haystack"],
      properties: {
        kind: { const: "In" },
        needle: { $ref: "#/$defs/Node" },
        haystack: { $ref: "#/$defs/Node" },
      },
    },
  },
});
