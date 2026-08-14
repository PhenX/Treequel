import { type Severity, adapterOxc, capture } from "@treequel/capture";
import { parseSync } from "oxc-parser";

export interface LambdaDiagnostic {
  /** Numeric part of the Rxxxx code (used as the ts.Diagnostic code). */
  readonly code: number;
  readonly raw: string;
  /** Offset within the *lambda source* (not the wrapping parens). */
  readonly start: number;
  readonly length: number;
  readonly message: string;
  readonly severity: Severity;
}

/**
 * Validate a lambda's source text through the shared capture pipeline, re-parsed
 * with oxc so the editor sees exactly what the build sees (true 3-host parity).
 * Offsets are relative to `source` (the wrapping `(` is subtracted out).
 */
export function diagnoseLambdaSource(source: string): LambdaDiagnostic[] {
  const res = parseSync("lambda.ts", `(${source})`, { lang: "ts" });
  if (res.errors.length > 0) return [];
  const program = res.program as unknown as { body: Array<{ type: string; expression?: unknown }> };
  const stmt = program.body[0];
  let node = (stmt?.expression ?? stmt) as { type: string; expression?: unknown };
  while (node.type === "ParenthesizedExpression") node = node.expression as typeof node;

  const result = capture(node as never, adapterOxc);
  return result.diagnostics.map((d) => ({
    code: Number(d.code.replace(/\D/g, "")),
    raw: d.code,
    start: Math.max(0, (d.span ? d.span.start : 1) - 1),
    length: d.span ? d.span.end - d.span.start : source.length,
    message: `${d.code}: ${d.message}${d.hint ? ` — ${d.hint}` : ""}`,
    severity: d.severity,
  }));
}
