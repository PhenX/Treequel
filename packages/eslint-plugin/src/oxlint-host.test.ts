/**
 * Oxlint-host parity: the built plugin loads through oxlint's `jsPlugins` and
 * reports the same codes, severities and autofix as the ESLint host. The suite
 * needs `dist/` (`npx tsc -b`) and skips — loudly, via its name — without it.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(here, "../dist/index.js");
const oxlintBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve("oxlint/package.json")),
  "bin",
  "oxlint",
);

interface OxlintDiagnostic {
  message: string;
  code: string;
  severity: string;
}

function runOxlint(
  dir: string,
  args: string[],
): { diagnostics: OxlintDiagnostic[]; status: number } {
  let stdout: string;
  let status = 0;
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [oxlintBin, "--format", "json", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    status = err.status ?? -1;
  }
  try {
    const parsed = JSON.parse(stdout) as { diagnostics: OxlintDiagnostic[] };
    return { diagnostics: parsed.diagnostics, status };
  } catch {
    throw new Error(`oxlint did not emit JSON (exit ${status}):\n${stdout}\n${stderr}`);
  }
}

describe.skipIf(!fs.existsSync(distEntry))(
  "oxlint host (loads dist — run `npx tsc -b` first)",
  () => {
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "greffon-oxlint-"));
      fs.writeFileSync(
        path.join(dir, ".oxlintrc.json"),
        JSON.stringify({
          jsPlugins: [{ name: "greffon", specifier: distEntry }],
          rules: { "greffon/valid-expression": "error", "greffon/no-opaque-callback": "warn" },
        }),
      );
    });
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("reports the same codes and severities as the ESLint host", () => {
      fs.writeFileSync(
        path.join(dir, "queries.ts"),
        [
          'import { createContext } from "@greffon/query";',
          "declare const provider: unknown;",
          "declare const myPredicate: (u: { id: number }) => boolean;",
          "const db = createContext(provider);",
          "db.users.filter((u: { id: number }) => u.id == 1);",
          "db.users.filter((u: { age: number }) => { return u.age > 18; });",
          "db.users.filter(myPredicate);",
          "Math.max(0, 1);",
          "",
        ].join("\n"),
      );
      const { diagnostics, status } = runOxlint(dir, ["queries.ts"]);
      expect(status).toBe(1);
      const greffon = diagnostics.filter((d) => d.code.startsWith("greffon("));
      const byCode = (code: string) => greffon.filter((d) => d.message.startsWith(code));
      expect(byCode("R1103")).toMatchObject([
        { code: "greffon(valid-expression)", severity: "error" },
      ]);
      expect(byCode("R1101")).toMatchObject([
        { code: "greffon(valid-expression)", severity: "error" },
      ]);
      expect(byCode("R2003")).toMatchObject([
        { code: "greffon(no-opaque-callback)", severity: "warning" },
      ]);
      expect(greffon).toHaveLength(3);
    });

    it("applies the R1103 autofix (== to ===)", () => {
      fs.writeFileSync(
        path.join(dir, "fixable.ts"),
        'import { createContext } from "@greffon/query";\ndeclare const provider: unknown;\nconst db = createContext(provider);\ndb.users.filter((u: { id: number }) => u.id == 1);\n',
      );
      runOxlint(dir, ["--fix", "fixable.ts"]);
      expect(fs.readFileSync(path.join(dir, "fixable.ts"), "utf8")).toContain("u.id === 1");
    });
  },
);
