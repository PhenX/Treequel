import greffon from "@greffon/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// The subset rules read a TypeScript AST, so point the files you want checked at
// the TypeScript parser. Test files opt out — they exercise the opaque and
// in-memory paths on purpose.
export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
    plugins: greffon.configs.recommended.plugins,
    rules: greffon.configs.recommended.rules,
  },
];
