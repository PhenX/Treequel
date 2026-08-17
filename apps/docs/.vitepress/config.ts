import { defineConfig } from "vitepress";

// The site description carries the canonical positioning line (kept in sync with
// the README subtitle and the homepage hero).
export default defineConfig({
  lang: "en-US",
  title: "Treequel",
  description:
    "Expression trees for TypeScript. Write an ordinary lambda; it stays the function it always was, and becomes a typed, serializable tree you can evaluate, rewrite, print, store, send over the wire — or hand to a provider that translates it: a policy check, a remote filter, parameterized SQL.",
  base: "/Treequel/",
  cleanUrls: true,
  lastUpdated: true,
  // The area guide is contributor material, not a site page.
  srcExclude: ["AGENTS.md"],
  // The playground is a separate app copied into the site, not a VitePress page.
  // Every link to it must carry `target: "_self"`: the SPA router skips links
  // with a target attribute and does a full page load, instead of resolving
  // /playground/ as a (nonexistent) route and rendering the 404 page.
  ignoreDeadLinks: [/^\/playground\//],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      {
        text: "Reference",
        items: [
          { text: "Error reference", link: "/errors" },
          { text: "Tree JSON schema", link: "/reference/tree-schema" },
        ],
      },
      { text: "Playground", link: "/playground/", target: "_self" },
      { text: "GitHub", link: "https://github.com/PhenX/Treequel" },
    ],
    // Sections are reader tasks, in reading order: concepts first (the tree is
    // the product), then querying opened by its basics page and closed by the
    // SQL providers, then repo wiring, extending, and background. Guide URLs
    // stay flat under /guide/ regardless of grouping.
    sidebar: {
      "/": [
        {
          text: "Start here",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "The expression tree", link: "/guide/the-tree" },
            { text: "The expression subset", link: "/guide/the-subset" },
            { text: "Applications", link: "/guide/applications" },
          ],
        },
        {
          text: "Querying",
          items: [
            { text: "Queries & executors", link: "/guide/queries" },
            { text: "The boundary rule", link: "/guide/the-boundary-rule" },
            { text: "Joins & includes", link: "/guide/joins-and-includes" },
            { text: "Grouping & aggregates", link: "/guide/grouping" },
            { text: "Computed members", link: "/guide/computed-members" },
            { text: "SQL providers", link: "/guide/sql-providers" },
          ],
        },
        {
          text: "Build & tooling",
          items: [
            { text: "Compiling with tsc", link: "/guide/compiling-with-tsc" },
            { text: "Editor & lint", link: "/guide/editor-and-lint" },
          ],
        },
        {
          text: "Extending",
          items: [{ text: "Writing a provider", link: "/guide/writing-a-provider" }],
        },
        {
          text: "Background",
          items: [
            { text: "The C# lineage", link: "/guide/lineage" },
            { text: "Compared to ORMs & rules engines", link: "/guide/comparison" },
          ],
        },
        {
          text: "Reference",
          items: [
            // The error page's URL is a contract: /errors#Rxxxx anchors are
            // emitted in build errors, editor squiggles, and lint output.
            { text: "Error reference", link: "/errors" },
            { text: "Tree JSON schema", link: "/reference/tree-schema" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/PhenX/Treequel" }],
    footer: {
      message: "MIT licensed. Expression trees for TypeScript.",
      copyright: "© Fabien Ménager",
    },
    search: { provider: "local" },
  },
});
