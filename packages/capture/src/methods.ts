/**
 * Query methods whose lambda arguments are expression positions — the calls at
 * which a lambda literal is traced and reified into a tree. The single shared
 * home for the set: the build transform, the ts-plugin and the eslint-plugin all
 * depend on `@treequel/capture`, so they read one list and never disagree about
 * what gets traced.
 */
export const QUERY_METHODS: ReadonlySet<string> = new Set([
  "filter",
  "map",
  "orderBy",
  "orderByDescending",
  "thenBy",
  "thenByDescending",
  "groupBy",
  "count",
  "some",
  "every",
  "first",
  "firstOrThrow",
  "single",
  "sum",
  "min",
  "max",
  "avg",
  "join",
  "leftJoin",
  "flatMap",
]);
