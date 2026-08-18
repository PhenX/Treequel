import { createRequire } from "node:module";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite";

// monaco-editor's `exports` map rewrites `./*` to `./esm/vs/*.js`, and Vite keeps
// the `?worker` query on the specifier while matching it — so a bare
// `monaco-editor/editor/editor.worker?worker` import resolves to a file that
// doesn't exist. Rewrite those worker specifiers to the real ESM files, keeping
// the `?worker` query so Vite still bundles them as web workers.
const require = createRequire(import.meta.url);
const monacoEsmVs = path
  .dirname(path.dirname(require.resolve("monaco-editor/editor/editor.worker.js")))
  .replace(/\\/g, "/");

// `editor.main` registers Monaco's CSS, HTML and TypeScript language services,
// none of which the playground uses — TS surfaces color with a Monarch-only mode
// and there is no CSS or HTML anywhere. Replace those service registrations with
// empty modules so their workers (the TypeScript one alone is ~7 MB) never enter
// the bundle. JSON is left alone, so it keeps validating the captures object.
const dropUnusedMonacoServices: Plugin = {
  name: "greffon:drop-unused-monaco-services",
  enforce: "pre",
  load(id) {
    return /languages[\\/]features[\\/](css|html|typescript)[\\/]register\.js$/.test(id)
      ? "export {};"
      : null;
  },
};

// The playground is served under the docs site at /Greffon/playground/, so it
// builds straight into the docs `public/` folder that VitePress copies verbatim.
export default defineConfig({
  base: "/Greffon/playground/",
  build: {
    outDir: "../docs/public/playground",
    emptyOutDir: true,
  },
  plugins: [dropUnusedMonacoServices],
  resolve: {
    alias: [{ find: /^monaco-editor\/(.*)\?worker$/, replacement: `${monacoEsmVs}/$1.js?worker` }],
  },
});
