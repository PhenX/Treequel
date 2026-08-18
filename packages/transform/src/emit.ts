import { type Node, isSpread } from "@greffon/tree";

/** Render a JS-source expression for a `Constant`'s value (build-time literals only). */
function emitValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return `${v}n`;
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (Number.isNaN(v)) return "NaN";
      if (v === Infinity) return "Infinity";
      if (v === -Infinity) return "-Infinity";
      return String(v);
    default:
      return JSON.stringify(v) ?? "undefined";
  }
}

/**
 * Emit a tree as a plain JS object-literal expression (spans stripped). This is
 * inlined as the `body` of `__expr({...})` so the runtime host stays O(1) — no
 * parsing, no deserialization.
 */
export function emitNode(n: Node): string {
  switch (n.kind) {
    case "Param":
      return `{kind:"Param",name:${JSON.stringify(n.name)}}`;
    case "Capture":
      return `{kind:"Capture",name:${JSON.stringify(n.name)}${n.global ? ",global:true" : ""}}`;
    case "Constant":
      return `{kind:"Constant",value:${emitValue(n.value)}}`;
    case "Member":
      return `{kind:"Member",object:${emitNode(n.object)},prop:${JSON.stringify(n.prop)}${n.optional ? ",optional:true" : ""}}`;
    case "Index":
      return `{kind:"Index",object:${emitNode(n.object)},index:${emitNode(n.index)}${n.optional ? ",optional:true" : ""}}`;
    case "Call":
      return `{kind:"Call",callee:${emitNode(n.callee)},args:[${n.args.map(emitNode).join(",")}]${n.optional ? ",optional:true" : ""}}`;
    case "Binary":
      return `{kind:"Binary",op:${JSON.stringify(n.op)},left:${emitNode(n.left)},right:${emitNode(n.right)}}`;
    case "Logical":
      return `{kind:"Logical",op:${JSON.stringify(n.op)},left:${emitNode(n.left)},right:${emitNode(n.right)}}`;
    case "Unary":
      return `{kind:"Unary",op:${JSON.stringify(n.op)},operand:${emitNode(n.operand)}}`;
    case "Ternary":
      return `{kind:"Ternary",test:${emitNode(n.test)},then:${emitNode(n.then)},else:${emitNode(n.else)}}`;
    case "Template":
      return `{kind:"Template",quasis:[${n.quasis.map((q) => JSON.stringify(q)).join(",")}],exprs:[${n.exprs.map(emitNode).join(",")}]}`;
    case "ObjectLit":
      return `{kind:"ObjectLit",props:[${n.props
        .map((p) =>
          isSpread(p)
            ? `{spread:${emitNode(p.spread)}}`
            : `{key:${JSON.stringify(p.key)},value:${emitNode(p.value)}}`,
        )
        .join(",")}]}`;
    case "ArrayLit":
      return `{kind:"ArrayLit",elements:[${n.elements
        .map((e) => (isSpread(e) ? `{spread:${emitNode(e.spread)}}` : emitNode(e)))
        .join(",")}]}`;
    case "Lambda":
      return `{kind:"Lambda",params:[${n.params.map((p) => JSON.stringify(p)).join(",")}],body:${emitNode(n.body)}}`;
    case "In":
      return `{kind:"In",needle:${emitNode(n.needle)},haystack:${emitNode(n.haystack)}}`;
  }
}

/** Line:column (1-based line, 0-based column) for a source offset. */
export function offsetToLineCol(code: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last - 1 };
}
