import { __setFallbackHost } from "@greffon/core";
import { fallbackHost } from "./host.js";

/**
 * Side-effecting entry: `import "@greffon/fallback/register"` to enable runtime
 * `toString()` capture for `expr()` when the build plugin is not configured.
 */
__setFallbackHost(fallbackHost);
