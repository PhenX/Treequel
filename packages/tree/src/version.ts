/**
 * The expression-tree wire-format version.
 *
 * Bump on any breaking change to {@link Node} shapes or serialization. The
 * deserializer refuses to read trees whose major version is newer than the one
 * it understands (diagnostic R1901).
 */
export const FORMAT_VERSION = 1 as const;

export type FormatVersion = typeof FORMAT_VERSION;
