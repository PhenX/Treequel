/**
 * The expression-tree algebra: a small, closed, versioned discriminated union.
 *
 * Design rules:
 *  - JSON-plain: no functions, no prototypes, no cycles. structuredClone /
 *    postMessage / HTTP safe once run through {@link serialize}.
 *  - Every node MAY carry a `span` (source offsets); it is stripped on serialize
 *    by default.
 *  - There is deliberately no Assignment, Sequence, New, Await, Yield,
 *    TaggedTemplate, Class or This in v1.
 */

/** Source span, in UTF-16 code-unit offsets into the original module. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A JSON-native value. `Constant` may also hold JSON-unsafe values (Date, …) at runtime. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Binary operators with cross-provider semantics. Note: `==`/`!=` are banned (R1103). */
export type BinaryOp =
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "instanceof"
  | "in";

export type LogicalOp = "&&" | "||" | "??";

export type UnaryOp = "!" | "-" | "+" | "typeof";

/** Tag for `Constant` values that are not JSON-native; owned by (de)serialize. */
export type ConstTag = "date" | "bigint" | "regexp" | "undefined" | "number";

interface Base {
  readonly span?: Span;
}

/** A reference to a lambda parameter, e.g. the `u` in `u => u.age`. */
export interface Param extends Base {
  readonly kind: "Param";
  readonly name: string;
}

/**
 * A free variable captured from the enclosing scope (resolved from `scope()` at
 * execution time), or — when `global` is set — a safelisted global (`Math`,
 * `Date`, …) resolved from a fixed realm table.
 */
export interface Capture extends Base {
  readonly kind: "Capture";
  readonly name: string;
  readonly global?: true;
}

/** A literal, or the result of partial evaluation. `value` is the real JS value at runtime. */
export interface Constant extends Base {
  readonly kind: "Constant";
  readonly value: unknown;
  readonly type?: ConstTag;
}

/** Static property access `object.prop` (distinct from computed {@link Index}). */
export interface Member extends Base {
  readonly kind: "Member";
  readonly object: Node;
  readonly prop: string;
  readonly optional?: true;
}

/** Computed access `object[index]`. */
export interface Index extends Base {
  readonly kind: "Index";
  readonly object: Node;
  readonly index: Node;
  readonly optional?: true;
}

/** A call `callee(...args)`. Method calls have `callee` = a {@link Member}. */
export interface Call extends Base {
  readonly kind: "Call";
  readonly callee: Node;
  readonly args: readonly Node[];
  readonly optional?: true;
}

export interface Binary extends Base {
  readonly kind: "Binary";
  readonly op: BinaryOp;
  readonly left: Node;
  readonly right: Node;
}

export interface Logical extends Base {
  readonly kind: "Logical";
  readonly op: LogicalOp;
  readonly left: Node;
  readonly right: Node;
}

export interface Unary extends Base {
  readonly kind: "Unary";
  readonly op: UnaryOp;
  readonly operand: Node;
}

export interface Ternary extends Base {
  readonly kind: "Ternary";
  readonly test: Node;
  readonly then: Node;
  readonly else: Node;
}

/** A template literal. `quasis.length === exprs.length + 1`. */
export interface Template extends Base {
  readonly kind: "Template";
  readonly quasis: readonly string[];
  readonly exprs: readonly Node[];
}

export type ObjectProp =
  | { readonly key: string; readonly value: Node }
  | { readonly spread: Node };

export interface ObjectLit extends Base {
  readonly kind: "ObjectLit";
  readonly props: readonly ObjectProp[];
}

export type ArrayElement = Node | { readonly spread: Node };

export interface ArrayLit extends Base {
  readonly kind: "ArrayLit";
  readonly elements: readonly ArrayElement[];
}

/** A nested arrow appearing as a call argument, e.g. `t => t.startsWith("a")`. */
export interface Lambda extends Base {
  readonly kind: "Lambda";
  readonly params: readonly string[];
  readonly body: Node;
}

/**
 * Membership test. Never emitted by capture; produced by a provider's normalize
 * pass from `arr.includes(x)`.
 */
export interface In extends Base {
  readonly kind: "In";
  readonly needle: Node;
  readonly haystack: Node;
}

export type Node =
  | Param
  | Capture
  | Constant
  | Member
  | Index
  | Call
  | Binary
  | Logical
  | Unary
  | Ternary
  | Template
  | ObjectLit
  | ArrayLit
  | Lambda
  | In;

export type NodeKind = Node["kind"];

/** All node kinds, as a runtime set (for validation / fuzzers). */
export const NODE_KINDS: readonly NodeKind[] = [
  "Param",
  "Capture",
  "Constant",
  "Member",
  "Index",
  "Call",
  "Binary",
  "Logical",
  "Unary",
  "Ternary",
  "Template",
  "ObjectLit",
  "ArrayLit",
  "Lambda",
  "In",
];

const KIND_SET = new Set<string>(NODE_KINDS);

/** Structural guard: is `x` shaped like a {@link Node}? */
export function isNode(x: unknown): x is Node {
  return (
    typeof x === "object" &&
    x !== null &&
    "kind" in x &&
    typeof (x as { kind: unknown }).kind === "string" &&
    KIND_SET.has((x as { kind: string }).kind)
  );
}

/** Discriminate a spread entry from a plain element/prop. */
export function isSpread(x: ArrayElement | ObjectProp): x is { readonly spread: Node } {
  return typeof x === "object" && x !== null && "spread" in x;
}
