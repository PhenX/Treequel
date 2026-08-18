import { type SqlDialect, escapeGlob } from "@greffon/sql-core";

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
  dateExtract(part, expr) {
    // strftime returns text ('2020', '01', …) and reads the value as UTC.
    const format = part === "year" ? "%Y" : part === "month" ? "%m" : "%d";
    return `CAST(strftime('${format}', ${expr}) AS INTEGER)`;
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
  // arrayContains expands one `?` per value; stay well under SQLite's
  // historical 999-variable default.
  maxBatchKeys: 500,
  coerceValue(value) {
    // SQLite has no boolean or date type: booleans store as 0/1, and Dates store
    // as ISO-8601 text (UTC, with a trailing `Z`) that `strftime` and ordering
    // both understand.
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value;
  },
};
