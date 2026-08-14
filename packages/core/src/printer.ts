import { type Node, isSpread } from "@treequel/tree";

/**
 * Render a tree back to readable, source-like text. Used by `Expr#toString`
 * (when the original `src` is absent) and by node inspection. Not a faithful
 * round-trippable emitter — it parenthesizes generously for clarity.
 */
export function print(n: Node): string {
  switch (n.kind) {
    case "Param":
      return n.name;
    case "Capture":
      return n.name;
    case "Constant":
      return printConstant(n.value);
    case "Member":
      return `${print(n.object)}${n.optional ? "?." : "."}${n.prop}`;
    case "Index":
      return `${print(n.object)}${n.optional ? "?." : ""}[${print(n.index)}]`;
    case "Call":
      return `${print(n.callee)}${n.optional ? "?." : ""}(${n.args.map(print).join(", ")})`;
    case "Binary":
      return `(${print(n.left)} ${n.op} ${print(n.right)})`;
    case "Logical":
      return `(${print(n.left)} ${n.op} ${print(n.right)})`;
    case "Unary":
      return n.op === "typeof" ? `typeof ${print(n.operand)}` : `${n.op}${print(n.operand)}`;
    case "Ternary":
      return `(${print(n.test)} ? ${print(n.then)} : ${print(n.else)})`;
    case "Template":
      return printTemplate(n.quasis, n.exprs);
    case "ObjectLit":
      return `{ ${n.props
        .map((p) => (isSpread(p) ? `...${print(p.spread)}` : `${p.key}: ${print(p.value)}`))
        .join(", ")} }`;
    case "ArrayLit":
      return `[${n.elements
        .map((e) => (isSpread(e) ? `...${print(e.spread)}` : print(e)))
        .join(", ")}]`;
    case "Lambda":
      return `(${n.params.join(", ")}) => ${print(n.body)}`;
    case "In":
      return `(${print(n.needle)} in ${print(n.haystack)})`;
  }
}

function printConstant(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return `Date(${JSON.stringify(value.toISOString())})`;
  if (value instanceof RegExp) return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function printTemplate(quasis: readonly string[], exprs: readonly Node[]): string {
  let out = "`" + (quasis[0] ?? "");
  for (let i = 0; i < exprs.length; i++) {
    out += "${" + print(exprs[i] as Node) + "}" + (quasis[i + 1] ?? "");
  }
  return out + "`";
}
