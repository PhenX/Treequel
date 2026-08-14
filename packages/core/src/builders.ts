import type {
  ArrayElement,
  BinaryOp,
  Binary,
  Call,
  Capture,
  Constant,
  Index,
  Lambda,
  Logical,
  LogicalOp,
  Member,
  Node,
  ObjectProp,
  Param,
  Template,
  Ternary,
  Unary,
  UnaryOp,
} from "@treequel/tree";

/**
 * Terse node constructors for tests, capture output, and rewrite passes. Names
 * are short because trees are dense; grouped under `b` to avoid polluting scope.
 */
export const b = {
  param: (name: string): Param => ({ kind: "Param", name }),
  capture: (name: string, global?: true): Capture =>
    global ? { kind: "Capture", name, global } : { kind: "Capture", name },
  const: (value: unknown): Constant => ({ kind: "Constant", value }),
  member: (object: Node, prop: string, optional?: true): Member =>
    optional ? { kind: "Member", object, prop, optional } : { kind: "Member", object, prop },
  index: (object: Node, index: Node): Index => ({ kind: "Index", object, index }),
  call: (callee: Node, args: Node[] = []): Call => ({ kind: "Call", callee, args }),
  method: (object: Node, prop: string, args: Node[] = []): Call => ({
    kind: "Call",
    callee: { kind: "Member", object, prop },
    args,
  }),
  binary: (op: BinaryOp, left: Node, right: Node): Binary => ({ kind: "Binary", op, left, right }),
  logical: (op: LogicalOp, left: Node, right: Node): Logical => ({
    kind: "Logical",
    op,
    left,
    right,
  }),
  unary: (op: UnaryOp, operand: Node): Unary => ({ kind: "Unary", op, operand }),
  ternary: (test: Node, then: Node, els: Node): Ternary => ({
    kind: "Ternary",
    test,
    then,
    else: els,
  }),
  template: (quasis: string[], exprs: Node[]): Template => ({ kind: "Template", quasis, exprs }),
  object: (props: ObjectProp[]): Node => ({ kind: "ObjectLit", props }),
  array: (elements: ArrayElement[]): Node => ({ kind: "ArrayLit", elements }),
  lambda: (params: string[], body: Node): Lambda => ({ kind: "Lambda", params, body }),
} as const;
