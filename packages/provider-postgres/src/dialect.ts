import { type SqlDialect, escapeLike } from "@greffon/sql-core";

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
  dateExtract(part, expr) {
    const field = part === "year" ? "YEAR" : part === "month" ? "MONTH" : "DAY";
    return `CAST(EXTRACT(${field} FROM ${expr}) AS INTEGER)`;
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
