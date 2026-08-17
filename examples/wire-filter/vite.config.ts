import { treequel } from "@treequel/vite";
import { defineConfig } from "vite";

// One line reifies the filter lambdas into expression trees at build time —
// only the client side needs it; the receiving side works from JSON alone.
export default defineConfig({
  plugins: [treequel()],
});
