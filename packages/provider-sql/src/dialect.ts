import type { TranslateContext } from "./translate.js";

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

export const pgDialect: SqlDialect = {
  name: "postgres",
  placeholder(index) {
    return `$${index}`;
  },
  floatCast(expr) {
    return `${expr}::float8`;
  },
  stringMatch(kind, recv, literal, ctx) {
    const escaped = escapeLike(literal);
    const pattern =
      kind === "startsWith" ? `${escaped}%` : kind === "endsWith" ? `%${escaped}` : `%${escaped}%`;
    return `(${recv} LIKE ${ctx.param(pattern)} ESCAPE '\\')`;
  },
  arrayContains(needle, values, ctx) {
    return `(${needle} = ANY(${ctx.param(values)}))`;
  },
  power(base, exponent) {
    return `POWER(${base}, ${exponent})`;
  },
  nullsSuffix() {
    return "";
  },
  offsetRequiresLimit: false,
  coerceValue(value) {
    return value;
  },
};

export const sqliteDialect: SqlDialect = {
  name: "sqlite",
  placeholder() {
    return "?";
  },
  floatCast(expr) {
    return `CAST(${expr} AS REAL)`;
  },
  stringMatch(kind, recv, literal, ctx) {
    // GLOB is case-sensitive (LIKE is not), matching JS string methods.
    const escaped = escapeGlob(literal);
    const pattern =
      kind === "startsWith" ? `${escaped}*` : kind === "endsWith" ? `*${escaped}` : `*${escaped}*`;
    return `(${recv} GLOB ${ctx.param(pattern)})`;
  },
  arrayContains(needle, values, ctx) {
    // SQLite has no array parameter; expand to IN (...). `x IN ()` is a syntax
    // error, and `[].includes(x)` is false, so an empty set is a false literal.
    if (values.length === 0) return "(0 = 1)";
    const placeholders = values.map((v) => ctx.param(v)).join(", ");
    return `(${needle} IN (${placeholders}))`;
  },
  power(base, exponent) {
    return `POWER(${base}, ${exponent})`;
  },
  nullsSuffix(desc) {
    // Postgres (and the memory engine) default to NULLS LAST on ASC / FIRST on
    // DESC; SQLite defaults the other way, so state it explicitly.
    return desc ? " NULLS FIRST" : " NULLS LAST";
  },
  offsetRequiresLimit: true,
  coerceValue(value) {
    return typeof value === "boolean" ? (value ? 1 : 0) : value;
  },
};
