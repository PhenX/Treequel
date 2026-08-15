import { type SqlDialect, escapeGlob } from "@treequel/provider-sql";

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
