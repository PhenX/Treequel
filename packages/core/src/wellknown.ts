/**
 * Shared vocabularies:
 *  - {@link REALM}: the fixed global table that resolves `Capture{global:true}`
 *, keeping `scope()` minimal and SSR-safe.
 *  - {@link GLOBALS_SAFELIST}: identifiers that capture treats as globals, not
 *    free variables.
 *  - {@link WellKnown}: the calls all first-party providers commit to, so they
 *    share one vocabulary and one conformance suite.
 */

/** Global objects resolvable inside expression lambdas, by name. */
export const REALM: Readonly<Record<string, unknown>> = Object.freeze({
  Math,
  Number,
  String,
  Boolean,
  Date,
  JSON,
  Array,
  Object,
  Infinity,
  NaN,
  undefined,
  BigInt,
  // Intl is optional across runtimes; include when present.
  ...(typeof Intl !== "undefined" ? { Intl } : {}),
});

/** Identifier names capture treats as globals (→ `Capture{global:true}`), not captures. */
export const GLOBALS_SAFELIST: readonly string[] = [
  "Math",
  "Number",
  "String",
  "Boolean",
  "Date",
  "JSON",
  "Array",
  "Object",
  "Infinity",
  "NaN",
  "undefined",
  "Intl",
  "BigInt",
];

export interface WellKnownEntry {
  /** Receiver category the method/member applies to. */
  readonly on: "string" | "number" | "array" | "date" | "Math" | "any";
  /** `"member"` for property reads (e.g. `.length`), `"method"` for calls. */
  readonly kind: "member" | "method";
}

/**
 * The recognized surface: names first-party providers share. Unknown calls are
 * still *legal in the tree* — each provider decides to translate, fold, or
 * reject (R2001). This registry only fixes the shared vocabulary + arities.
 */
export const WellKnown: Readonly<Record<string, WellKnownEntry>> = Object.freeze({
  // String
  startsWith: { on: "string", kind: "method" },
  endsWith: { on: "string", kind: "method" },
  includes: { on: "any", kind: "method" }, // string.includes or array.includes
  toLowerCase: { on: "string", kind: "method" },
  toUpperCase: { on: "string", kind: "method" },
  trim: { on: "string", kind: "method" },
  slice: { on: "any", kind: "method" },
  indexOf: { on: "any", kind: "method" },
  length: { on: "any", kind: "member" },
  // Array (relational)
  some: { on: "array", kind: "method" },
  every: { on: "array", kind: "method" },
  // Date
  getFullYear: { on: "date", kind: "method" },
  getMonth: { on: "date", kind: "method" },
  getDate: { on: "date", kind: "method" },
  // Math (as members of the Math global)
  abs: { on: "Math", kind: "method" },
  floor: { on: "Math", kind: "method" },
  ceil: { on: "Math", kind: "method" },
  round: { on: "Math", kind: "method" },
});

/** Is `name` a member/method the shared vocabulary recognizes? */
export function isWellKnown(name: string): boolean {
  return Object.hasOwn(WellKnown, name);
}
