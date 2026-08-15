import type { TranslateContext } from "./context.js";

export type StringMatch = "startsWith" | "endsWith" | "includes";

/**
 * The parts of SQL generation that differ between databases. One implementation
 * per target; `translate` and `compile` stay dialect-agnostic and delegate here.
 * The memory provider is the reference semantics, so every dialect must produce
 * SQL that yields the same rows — case-sensitive string matching, Postgres-style
 * null ordering, and float-typed aggregates included.
 */
export interface SqlDialect {
  readonly name: string;
  /** Placeholder for the value pushed at 1-based position `index`. */
  placeholder(index: number): string;
  /** Cast `expr` to a floating type so aggregates return a JS number. */
  floatCast(expr: string): string;
  /** Case-sensitive prefix/suffix/substring test of `recv` against a constant `literal`. */
  stringMatch(kind: StringMatch, recv: string, literal: string, ctx: TranslateContext): string;
  /** Membership of `needle` in a constant array `values`. */
  arrayContains(needle: string, values: readonly unknown[], ctx: TranslateContext): string;
  /** `base ** exponent`. */
  power(base: string, exponent: string): string;
  /** ORDER BY null placement matching the memory engine (Postgres defaults); `""` to rely on the engine. */
  nullsSuffix(desc: boolean): string;
  /** True when `OFFSET` must be preceded by a `LIMIT` (SQLite). */
  readonly offsetRequiresLimit: boolean;
  /**
   * Max keys per batched `include` fetch. Set when `arrayContains` expands one
   * placeholder per value (SQLite's variable limit); omit for array parameters.
   */
  readonly maxBatchKeys?: number;
  /**
   * Set `false` when the target lacks `ROW_NUMBER() OVER (…)`; per-parent
   * include slices are then refused instead of miscompiled. Omitted = capable.
   */
  readonly windowFunctions?: boolean;
  /** Coerce a bound value to what the driver accepts (e.g. boolean → 0/1). */
  coerceValue(value: unknown): unknown;
}

/** Escape LIKE metacharacters so a literal matches literally (used with `ESCAPE '\'`). */
export function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Escape GLOB metacharacters (`*`, `?`, `[`) by bracket-wrapping each one. */
export function escapeGlob(s: string): string {
  return s.replace(/[[*?]/g, (c) => `[${c}]`);
}
