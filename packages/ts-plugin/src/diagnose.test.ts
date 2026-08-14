import { describe, expect, it } from "vitest";
import { diagnoseLambdaSource } from "./diagnose.js";

describe("diagnoseLambdaSource (shared-parity editor diagnostics)", () => {
  it("returns no diagnostics for a valid lambda", () => {
    expect(diagnoseLambdaSource("u => u.age > minAge")).toEqual([]);
  });

  it("flags loose equality with the R1103 code and a source-relative span", () => {
    const [d] = diagnoseLambdaSource("u => u.id == 1");
    expect(d?.code).toBe(1103);
    expect(d?.raw).toBe("R1103");
    expect(d?.severity).toBe("error");
    // span points at `u.id == 1` inside the source (offset 5), not the wrapping paren
    expect("u => u.id == 1".slice(d!.start, d!.start + d!.length)).toBe("u.id == 1");
  });

  it("flags block bodies (R1101) and new (R1105)", () => {
    expect(diagnoseLambdaSource("u => { return u.age; }").map((d) => d.raw)).toContain("R1101");
    expect(diagnoseLambdaSource("u => new Date(u.ts)").map((d) => d.raw)).toContain("R1105");
  });

  it("produces the same code as the build for the same lambda", () => {
    // Parity spot-check: this is the exact message the editor squiggle shows.
    const [d] = diagnoseLambdaSource("u => this.x");
    expect(d?.raw).toBe("R1104");
    expect(d?.message).toContain("R1104");
  });
});
