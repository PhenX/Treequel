import { defineConfig } from "vite";

// The playground is served under the docs site at /Treequel/playground/, so it
// builds straight into the docs `public/` folder that VitePress copies verbatim.
export default defineConfig({
  base: "/Treequel/playground/",
  build: {
    outDir: "../docs/public/playground",
    emptyOutDir: true,
  },
});
