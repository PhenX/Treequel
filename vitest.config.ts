import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { treequel } from "./packages/vite/src/index.js";

const pkg = (name: string, entry = "src/index.ts"): string =>
  fileURLToPath(new URL(`./packages/${name}/${entry}`, import.meta.url));

/**
 * Alias every `@treequel/*` specifier to its TypeScript source so the test
 * suite runs against `src/` directly — no build step required in dev/CI.
 */
export default defineConfig({
  // The Treequel plugin reifies query lambdas into real Expr trees for:
  //  - `*.reify.test.ts` provider tests (exercise the true build-time path),
  //  - the conformance corpus in `linq/src/testing.ts` (its expr() calls), and
  //  - example source modules under `examples/**/src` (they ship real queries),
  // while ordinary unit tests stay plain (opaque lambdas / memory path).
  // `@treequel/core` is traced so the corpus can import `expr` from it.
  plugins: [
    treequel({
      packages: ["@treequel/linq", "@treequel/core"],
      include: [
        /\.reify\.test\.ts$/,
        /packages[\\/]linq[\\/]src[\\/]testing\.ts$/,
        // example source modules, but not their `.test.ts` files
        /[\\/]examples[\\/].+[\\/]src[\\/].+(?<!\.test)\.ts$/,
      ],
    }),
  ],
  resolve: {
    alias: {
      "@treequel/tree": pkg("tree"),
      "@treequel/core": pkg("core"),
      "@treequel/capture": pkg("capture"),
      "@treequel/fallback": pkg("fallback"),
      "@treequel/transform": pkg("transform"),
      "@treequel/vite": pkg("vite"),
      "@treequel/linq/testing": pkg("linq", "src/testing.ts"),
      "@treequel/linq": pkg("linq"),
      "@treequel/provider-memory": pkg("provider-memory"),
      "@treequel/sql-core": pkg("sql-core"),
      "@treequel/provider-postgres": pkg("provider-postgres"),
      "@treequel/provider-sqlite": pkg("provider-sqlite"),
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
