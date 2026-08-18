import { type FallbackHost, type Node, GreffonError } from "@greffon/core";
import { reifyFromSource } from "./parse.js";

// Minimal ambient — we only read NODE_ENV, and guard with `typeof process`.
declare const process: { env?: Record<string, string | undefined> } | undefined;

let warned = false;

/** Best-effort production detection (kept dependency-free / SSR-safe). */
function isProduction(): boolean {
  try {
    return (
      typeof process !== "undefined" &&
      (process as { env?: Record<string, string | undefined> }).env?.NODE_ENV === "production"
    );
  } catch {
    return false;
  }
}

/**
 * The runtime `toString()` capture host. Wired into `core` via
 * `__setFallbackHost`. Only invoked when a provider reads an `Expr`'s tree that
 * the build plugin never produced.
 */
export const fallbackHost: FallbackHost = (f) => {
  if (isProduction()) {
    throw new GreffonError(
      "R3003",
      "The runtime fallback is refused in production builds (minified source can't be reparsed reliably). Enable the @greffon/vite plugin.",
    );
  }

  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[greffon] R3001: runtime fallback active — parsing a lambda via toString(). " +
        "Enable the @greffon/vite build plugin for robust, closure-aware reification. " +
        "See https://greffon.dev/errors#R3001",
    );
  }

  const source = Function.prototype.toString.call(f);
  const { params, body, freeVars } = reifyFromSource(source);

  if (freeVars.length > 0) {
    throw new GreffonError(
      "R3002",
      `${freeVars.map((v) => `'${v}'`).join(", ")} ${freeVars.length === 1 ? "is" : "are"} captured from the enclosing scope; ` +
        "the runtime fallback cannot read closures. Enable the build plugin, or inline the value(s).",
    );
  }

  const bodyNode: Node = body;
  return { params, body: bodyNode, scope: () => ({}) };
};
