import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-Node script, no .d.ts; the shapes are asserted below.
import { lintMessage, TYPES, SCOPES } from "./check-commit.mjs";

const ok = (msg: string) => expect(lintMessage(msg)).toEqual([]);
const bad = (msg: string) => expect(lintMessage(msg).length).toBeGreaterThan(0);

describe("commit-message linter", () => {
  it("accepts well-formed headers with and without a scope", () => {
    ok("feat(core): add the rewriter");
    ok("docs: describe the boundary rule");
    ok("fix(sql): escape LIKE metacharacters");
    ok("refactor(ts-plugin): share the detector");
  });

  it("accepts a breaking-change bang", () => {
    ok("feat(tree)!: bump the wire format version");
  });

  it("rejects an unknown type", () => {
    bad("feats(core): add a thing");
    bad("wip: half a change");
  });

  it("rejects a scope outside the closed list", () => {
    bad("fix(dialect): tweak the pg table");
    bad("feat(router): add a route");
  });

  it("rejects a missing type/subject separator", () => {
    bad("add the rewriter");
    bad("Merge pull request #2 from PhenX/branch");
  });

  it("rejects an upper-case or period-terminated subject", () => {
    bad("feat(core): Add the rewriter");
    bad("feat(core): add the rewriter.");
  });

  it("rejects an over-long header", () => {
    bad(`feat(core): ${"x".repeat(100)}`);
  });

  it("lints only the header line, ignoring the body", () => {
    ok("feat(core): add the rewriter\n\nBody text can be Anything, ending with a period.");
  });

  it("exposes the closed type and scope lists", () => {
    expect(TYPES).toContain("revert");
    expect(SCOPES).toContain("eslint-plugin");
    expect(SCOPES).not.toContain("dialect");
  });
});
