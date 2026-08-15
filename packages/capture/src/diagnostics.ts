import type { Span } from "@treequel/tree";

/**
 * The diagnostics catalog — the single source of truth for every `Rxxxx` code
 *. Each entry fixes a code's severity and canonical summary; call
 * sites add contextual `detail`. The docs reference and error pages are
 * generated from this table.
 */

export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly span?: Span;
  /** A short, actionable fix hint. */
  readonly hint?: string;
}

export interface DiagnosticSpec {
  readonly severity: Severity;
  readonly summary: string;
  readonly hint?: string;
}

export const DIAGNOSTICS: Readonly<Record<string, DiagnosticSpec>> = Object.freeze({
  // R1100–R1199 — capture / subset
  R1100: { severity: "error", summary: "Unsupported syntax in an expression lambda" },
  R1101: {
    severity: "error",
    summary: "Block-bodied arrow is not allowed",
    hint: "Use a single expression; extract statements above the query.",
  },
  R1102: {
    severity: "error",
    summary: "Assignment and update operators are not allowed",
  },
  R1103: {
    severity: "error",
    summary: "Loose equality (== / !=) is not allowed",
    hint: "Use === / !== — loose equality has no sane cross-provider semantics.",
  },
  R1104: { severity: "error", summary: "`this` is not allowed in an expression lambda" },
  R1105: { severity: "error", summary: "`new` is not allowed in an expression lambda" },
  R1106: { severity: "error", summary: "`await` / `yield` are not allowed" },
  R1107: {
    severity: "error",
    summary: "Only arrow functions are allowed as nested lambdas",
  },
  R1108: { severity: "error", summary: "Tagged templates are not allowed" },
  R1109: {
    severity: "error",
    summary: "Regex literals are not allowed inside the body",
    hint: "Hoist the regex to a `const` above the query and capture it.",
  },
  R1110: { severity: "error", summary: "Comma / sequence expressions are not allowed" },
  R1111: {
    severity: "error",
    summary: "Rest and array-destructured parameters are not allowed (v1)",
  },
  R1112: { severity: "error", summary: "Default parameter values are not allowed (v1)" },

  // R1900–R1999 — tree format
  R1901: { severity: "error", summary: "Bad or newer serialized tree format" },

  // R2000–R2099 — provider / plan
  R2001: { severity: "error", summary: "Untranslatable call for this provider" },
  R2002: { severity: "error", summary: "Dynamic index or unresolvable column path" },
  R2003: {
    severity: "error",
    summary: "Opaque function passed to a query method",
    hint: "Write the lambda inline at the call site, or wrap it with expr().",
  },
  R2004: { severity: "warn", summary: "Opaque function accepted by the in-memory reference" },
  R2005: { severity: "error", summary: "Param-dependent call to a captured function" },
  R2006: {
    severity: "error",
    summary: "Ambiguous call — declare the column type in schema meta",
  },
  R2007: {
    severity: "error",
    summary: "Unknown navigation for include()",
    hint: "Declare the navigation in the relations map passed to createContext(provider, { relations }).",
  },
  R2008: {
    severity: "error",
    summary: "Invalid include()/thenInclude() usage",
    hint: "A navigation selector is a single property access (`u => u.orders`); thenInclude() must follow include().",
  },

  // R3000–R3099 — fallback
  R3001: { severity: "warn", summary: "Runtime fallback active (no build plugin ran)" },
  R3002: { severity: "error", summary: "Closure capture cannot be read by the runtime fallback" },
  R3003: { severity: "error", summary: "Runtime fallback refused in a production build" },

  // R4000–R4099 — plugin / config
  R4001: {
    severity: "warn",
    summary: "Traced context import could not be resolved",
    hint: "Wrap the lambda with expr(), or annotate the import with /* @treequel-context */.",
  },
  R4002: { severity: "info", summary: "Double transform detected; skipped" },
});

export function docsAnchor(code: string): string {
  return `https://treequel.dev/errors#${code}`;
}

const FALLBACK_SPEC: DiagnosticSpec = { severity: "error", summary: "Unsupported syntax" };

/** Compose a concrete {@link Diagnostic} from a catalog code plus context. */
export function makeDiagnostic(code: string, span?: Span, detail?: string): Diagnostic {
  const spec = DIAGNOSTICS[code] ?? FALLBACK_SPEC;
  const message = detail ? `${spec.summary}: ${detail}` : spec.summary;
  return {
    code,
    severity: spec.severity,
    message,
    ...(span ? { span } : {}),
    ...(spec.hint ? { hint: spec.hint } : {}),
  };
}

export function hasErrors(diags: readonly Diagnostic[]): boolean {
  return diags.some((d) => d.severity === "error");
}
