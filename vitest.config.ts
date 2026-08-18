import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { greffon } from "./packages/vite/src/index.js";

const pkg = (name: string, entry = "src/index.ts"): string =>
  fileURLToPath(new URL(`./packages/${name}/${entry}`, import.meta.url));

/**
 * Alias every `@greffon/*` specifier to its TypeScript source so the test
 * suite runs against `src/` directly — no build step required in dev/CI.
 */
export default defineConfig({
  // The Greffon plugin reifies query lambdas into real Expr trees for:
  //  - `*.reify.test.ts` provider tests (exercise the true build-time path),
  //  - the conformance corpus in `query/src/testing.ts` (its expr() calls), and
  //  - example source modules under `examples/**/src` (they ship real queries),
  // while ordinary unit tests stay plain (opaque lambdas / memory path).
  // `@greffon/core` is traced so the corpus can import `expr` from it.
  plugins: [
    greffon({
      packages: ["@greffon/query", "@greffon/core"],
      include: [
        /\.reify\.test\.ts$/,
        /packages[\\/]query[\\/]src[\\/]testing\.ts$/,
        // example source modules, but not their `.test.ts` files
        /[\\/]examples[\\/].+[\\/]src[\\/].+(?<!\.test)\.ts$/,
      ],
    }),
  ],
  resolve: {
    alias: {
      "@greffon/tree": pkg("tree"),
      "@greffon/core": pkg("core"),
      "@greffon/capture": pkg("capture"),
      "@greffon/fallback": pkg("fallback"),
      "@greffon/transform": pkg("transform"),
      "@greffon/vite": pkg("vite"),
      "@greffon/ts-transformer": pkg("ts-transformer"),
      "@greffon/query/testing": pkg("query", "src/testing.ts"),
      "@greffon/query": pkg("query"),
      "@greffon/provider-memory": pkg("provider-memory"),
      "@greffon/sql-core": pkg("sql-core"),
      "@greffon/provider-postgres": pkg("provider-postgres"),
      "@greffon/provider-sqlite": pkg("provider-sqlite"),
    },
  },
  test: {
    // Date getters (getFullYear/getMonth/getDate) read local-time fields; SQL
    // date extraction reads UTC. Pin the run to UTC so the two agree and date
    // assertions stay deterministic across CI runners. Node re-reads TZ per call.
    env: { TZ: "UTC" },
    include: [
      "packages/**/*.{test,spec}.ts",
      "examples/**/*.{test,spec}.ts",
      "scripts/**/*.{test,spec}.ts",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
