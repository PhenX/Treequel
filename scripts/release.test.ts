import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-Node script, no .d.ts.
import { nextVersion, renderChangelog, insertChangelog } from "./release.mjs";

describe("nextVersion", () => {
  it("bumps each component and zeroes the lower ones", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextVersion("0.1.3", "minor")).toBe("0.2.0");
    expect(nextVersion("1.4.2", "major")).toBe("2.0.0");
  });
});

describe("renderChangelog", () => {
  const headers = [
    "feat(core): add the rewriter",
    "feat(sql): translate startsWith",
    "fix(capture): reject loose equality",
    "perf(transform): skip non-matching modules faster",
    "docs: describe the boundary rule",
    "chore(deps): bump vitest",
    "test(tooling): add a benchmark",
    "feat(tree)!: bump the wire format",
  ];

  it("groups entries by type under stable headings", () => {
    const md = renderChangelog("0.2.0", "2026-08-14", headers);
    expect(md).toContain("## v0.2.0 — 2026-08-14");
    expect(md).toContain("### Features\n\n- add the rewriter (core)\n- translate startsWith (sql)");
    expect(md).toContain("### Fixes\n\n- reject loose equality (capture)");
    expect(md).toContain("### Performance");
    expect(md).toContain("### Documentation");
    // refactor/test/build/ci/chore/style/revert fold into one section
    expect(md).toContain("### Internal changes");
    expect(md).toContain("- bump vitest (deps)");
    expect(md).toContain("- add a benchmark (tooling)");
  });

  it("surfaces breaking changes first", () => {
    const md = renderChangelog("1.0.0", "2026-08-14", headers);
    const breaking = md.indexOf("### ⚠ Breaking changes");
    const features = md.indexOf("### Features");
    expect(breaking).toBeGreaterThanOrEqual(0);
    expect(breaking).toBeLessThan(features);
    expect(md).toContain("- bump the wire format (tree)");
  });

  it("omits empty groups and skips non-conventional lines", () => {
    const md = renderChangelog("0.1.1", "2026-08-14", [
      "fix(sql): quote identifiers",
      "Merge branch 'x'",
    ]);
    expect(md).toContain("### Fixes");
    expect(md).not.toContain("### Features");
    expect(md).not.toContain("Merge branch");
  });
});

describe("insertChangelog", () => {
  it("inserts a section directly below the marker, newest-first", () => {
    const existing =
      "# Changelog\n\nIntro.\n\n<!-- releases -->\n\n## v0.1.0 — 2026-01-01\n\n### Fixes\n\n- old\n";
    const out = insertChangelog(existing, "## v0.2.0 — 2026-08-14\n\n### Features\n\n- new\n");
    expect(out.indexOf("v0.2.0")).toBeLessThan(out.indexOf("v0.1.0"));
    expect(out).toContain("<!-- releases -->\n\n## v0.2.0");
  });

  it("adds a marker when none exists", () => {
    const out = insertChangelog("# Changelog\n", "## v0.1.0 — 2026-08-14\n");
    expect(out).toContain("<!-- releases -->");
    expect(out).toContain("## v0.1.0");
  });
});
