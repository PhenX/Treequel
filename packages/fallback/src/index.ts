/**
 * `@greffon/fallback` — the dev-only runtime `toString()` capture path. Import
 * `@greffon/fallback/register` for its side effect (wires the host into core),
 * or call {@link enableFallback} explicitly. Lazily used by `expr()` only when a
 * provider needs a tree the build plugin never produced.
 */
import { __setFallbackHost } from "@greffon/core";
import { fallbackHost } from "./host.js";

export { fallbackHost } from "./host.js";
export { parseFunctionSource, reifyFromSource } from "./parse.js";

/** Register the runtime fallback host with `@greffon/core`. Idempotent. */
export function enableFallback(): void {
  __setFallbackHost(fallbackHost);
}
