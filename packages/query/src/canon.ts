/**
 * Canonical JSON of a value: object keys sorted at every depth, so two
 * structurally equal values stringify identically. Used for hashing rows and
 * keys (distinct, groupBy, join buckets) and for deterministic ordering.
 */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as object).sort(([x], [y]) => (x < y ? -1 : 1)));
    }
    return val as unknown;
  });
}
