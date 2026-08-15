import { defineConfig } from "vitepress";

// The site description carries the canonical positioning line (kept in sync with
// the README subtitle and the homepage hero).
export default defineConfig({
  lang: "en-US",
  title: "Treequel",
  description:
    "Expression trees and LINQ for TypeScript. Write an ordinary lambda; it stays the function it always was, and becomes a typed, serializable expression tree that providers translate to SQL, remote filters, policy checks — or anything else. Not an ORM.",
  base: "/Treequel/",
  cleanUrls: true,
  lastUpdated: true,
  // The playground is a separate app copied into the site, not a VitePress page.
  ignoreDeadLinks: [/^\/playground\//],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/errors" },
      { text: "Playground", link: "/playground/", target: "_self" },
      { text: "GitHub", link: "https://github.com/PhenX/Treequel" },
    ],
    sidebar: {
      "/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "The expression subset", link: "/guide/the-subset" },
            { text: "Joins & includes", link: "/guide/joins-and-includes" },
            { text: "Grouping & aggregates", link: "/guide/grouping" },
            { text: "The boundary rule", link: "/guide/the-boundary-rule" },
            { text: "Writing a provider", link: "/guide/writing-a-provider" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "Error reference", link: "/errors" },
            { text: "Tree JSON schema", link: "/reference/tree-schema" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/PhenX/Treequel" }],
    footer: {
      message:
        "MIT licensed. Expression trees for TypeScript, with LINQ as the flagship application.",
      copyright: "© Fabien Ménager",
    },
    search: { provider: "local" },
  },
});
