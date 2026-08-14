/**
 * `@treequel/fallback` — the dev-only runtime `toString()` capture path. Import
 * `@treequel/fallback/register` for its side effect (wires the host into core),
 * or call {@link enableFallback} explicitly. Lazily used by `expr()` only when a
 * provider needs a tree the build plugin never produced.
 */
import { __setFallbackHost } from "@treequel/core";
import { fallbackHost } from "./host.js";

export { fallbackHost } from "./host.js";
export { parseFunctionSource, reifyFromSource } from "./parse.js";

/** Register the runtime fallback host with `@treequel/core`. Idempotent. */
export function enableFallback(): void {
  __setFallbackHost(fallbackHost);
}
