import { type CaptureResult, adapterOxc, capture, hasErrors } from "@greffon/capture";
import { type Node, GreffonError } from "@greffon/core";
import { parseScript } from "meriyah";

/**
 * Parse a function's source (from `Function.prototype.toString`) into an arrow
 * AST and run it through the shared capture pipeline. meriyah is a small pure-JS
 * ESTree parser — oxc-parser is a native binding and can't ship to browsers.
 */
export function parseFunctionSource(source: string): CaptureResult {
  const trimmed = source.trim();
  // Wrap in parens so `function (x){...}` and `(x) => ...` both parse as an expression.
  const ast = parseScript(`(${trimmed})`, { ranges: true }) as unknown as {
    body: Array<{ type: string; expression?: unknown }>;
  };
  const stmt = ast.body[0];
  const node = (stmt?.expression ?? stmt) as { type: string };
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
    throw new GreffonError(
      "R3002",
      `Could not parse a function from source: ${trimmed.slice(0, 60)}…`,
    );
  }
  return capture(node as never, adapterOxc);
}

/** Parse and validate, returning `{ params, body }` or throwing the first error. */
export function reifyFromSource(source: string): {
  params: readonly string[];
  body: Node;
  freeVars: string[];
} {
  const result = parseFunctionSource(source);
  if (hasErrors(result.diagnostics) || result.body === null) {
    const first = result.diagnostics.find((d) => d.severity === "error");
    throw new GreffonError(
      first?.code ?? "R3002",
      first?.message ?? "Unsupported lambda in fallback.",
    );
  }
  return { params: result.params, body: result.body, freeVars: result.freeVars };
}
