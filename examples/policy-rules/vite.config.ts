import { treequel } from "@treequel/vite";
import { defineConfig } from "vite";

// One line reifies the policy lambdas into expression trees at build time —
// the same setup a query-only app uses.
export default defineConfig({
  plugins: [treequel()],
});
