import { __setFallbackHost } from "@treequel/core";
import { fallbackHost } from "./host.js";

/**
 * Side-effecting entry: `import "@treequel/fallback/register"` to enable runtime
 * `toString()` capture for `expr()` when the build plugin is not configured.
 */
__setFallbackHost(fallbackHost);
