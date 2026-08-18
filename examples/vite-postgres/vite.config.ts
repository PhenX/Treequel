import { greffon } from "@greffon/vite";
import { defineConfig } from "vite";

// In a real app this single line reifies every traced query lambda into an
// expression tree at build time. The same query files run under Vitest with no
// plugin (in-memory), and compile to parameterized SQL in production.
export default defineConfig({
  plugins: [greffon()],
});
