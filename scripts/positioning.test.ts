import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Surfaces wrap the line differently, so matching runs on whitespace-flattened text.
const read = (rel: string): string => readFileSync(join(root, rel), "utf8").replace(/\s+/g, " ");

// The canonical positioning line, clause by clause (AGENTS.md, "One canonical
// positioning line"). A surface that stops carrying its clauses fails here —
// the line changes on every surface and in this list in the same commit.
const TITLE = "Expression trees for TypeScript";
const FUNCTION = "it stays the function it always was";
const TREE_OPS = "evaluate, rewrite, print, store, send over the wire";
const TARGETS = "a policy check, a remote filter, parameterized SQL";
const FLAGSHIP = "LINQ-style querying";
const NOT_ORM = "Not an ORM";

const ALL = [TITLE, FUNCTION, TREE_OPS, TARGETS, FLAGSHIP, NOT_ORM];

describe("the canonical positioning line is carried by every pinned surface", () => {
  it("README.md subtitle", () => {
    const readme = read("README.md");
    for (const clause of ALL) expect(readme).toContain(clause);
  });

  it("AGENTS.md canonical block", () => {
    const agents = read("AGENTS.md");
    for (const clause of ALL) expect(agents).toContain(clause);
  });

  // The hero tagline carries the line minus the flagship sentence; the hero
  // text carries the title.
  it("docs hero (apps/docs/index.md)", () => {
    const hero = read("apps/docs/index.md");
    for (const clause of [TITLE, FUNCTION, TREE_OPS, TARGETS, NOT_ORM]) {
      expect(hero).toContain(clause);
    }
  });

  it("docs site description (.vitepress/config.ts)", () => {
    const config = read("apps/docs/.vitepress/config.ts");
    for (const clause of [TITLE, FUNCTION, TREE_OPS, TARGETS, NOT_ORM]) {
      expect(config).toContain(clause);
    }
  });

  // The root package.json carries the short form: title, flagship, boundary.
  it("root package.json description", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      description: string;
    };
    for (const clause of [TITLE, FLAGSHIP, NOT_ORM]) {
      expect(pkg.description).toContain(clause);
    }
  });
});
