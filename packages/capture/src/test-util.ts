import { parseSync } from "oxc-parser";
import type { EsNode } from "./adapter.js";

/**
 * Parse a single lambda source string and return its ESTree arrow node. Test
 * helper only — hosts feed capture their own parser's arrow nodes.
 */
export function parseArrow(src: string, lang: "ts" | "js" = "ts"): EsNode {
  const res = parseSync(`__lambda.${lang}`, `const __f = ${src};`, { lang });
  if (res.errors.length > 0) {
    throw new Error(`parse error: ${res.errors.map((e) => e.message).join("; ")}`);
  }
  const program = res.program as unknown as { body: EsNode[] };
  const decl = program.body[0] as EsNode & { declarations: EsNode[] };
  let init = (decl.declarations[0] as EsNode & { init: EsNode }).init;
  while (init.type === "ParenthesizedExpression") init = init.expression as EsNode;
  return init;
}
