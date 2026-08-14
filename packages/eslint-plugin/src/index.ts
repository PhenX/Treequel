/**
 * `@treequel/eslint-plugin` — the same subset validator as the build and editor,
 * surfaced as lint-gated CI rules. The definition of done: an
 * invalid lambda produces the same code + message in editor, eslint and build.
 */
import { type Rule, noOpaqueCallback, validExpression } from "./rules.js";

export interface TreequelPlugin {
  readonly meta: { readonly name: string; readonly version: string };
  readonly rules: Readonly<Record<string, Rule>>;
  configs: Record<string, unknown>;
}

const plugin: TreequelPlugin = {
  meta: { name: "@treequel/eslint-plugin", version: "0.1.0" },
  rules: {
    "valid-expression": validExpression,
    "no-opaque-callback": noOpaqueCallback,
  },
  configs: {},
};

// Flat config preset (ESLint 9+).
plugin.configs.recommended = {
  plugins: { treequel: plugin },
  rules: {
    "treequel/valid-expression": "error",
    "treequel/no-opaque-callback": "warn",
  },
};

export default plugin;
export { validExpression, noOpaqueCallback } from "./rules.js";
export type { Rule } from "./rules.js";
