/**
 * `@treequel/tree` — the wire-format contract of the whole system.
 *
 * A small, closed, versioned, JSON-serializable expression-tree algebra with
 * ZERO runtime dependencies (forever). Everything else in Treequel is a
 * producer or consumer of these nodes.
 */
export * from "./nodes.js";
export * from "./serialize.js";
export * from "./version.js";
export * from "./error.js";
export { treeJsonSchema } from "./schema.js";
