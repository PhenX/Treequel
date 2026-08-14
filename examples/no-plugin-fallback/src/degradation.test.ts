/**
 * Demonstrates the graceful-degradation story — note this file
 * is NOT `*.reify.test.ts`, so the build plugin does NOT run. Lambdas are opaque
 * functions; the in-memory provider uses them directly, while a remote provider
 * relies on the lazily-registered runtime fallback.
 */
import { enableFallback } from "@treequel/fallback";
import { type SchemaMeta, type SqlExecutor, sqlProvider } from "@treequel/provider-sql";
import { createContext } from "@treequel/linq";
import { memoryProvider } from "@treequel/provider-memory";
import { beforeAll, describe, expect, it, vi } from "vitest";

interface User {
  id: number;
  name: string;
  age: number;
}
interface Schema {
  users: User;
}

const users: User[] = [
  { id: 1, name: "Ada", age: 36 },
  { id: 2, name: "Bob", age: 17 },
];
const schemaMeta: SchemaMeta = { users: { table: "users" } };

const memDb = createContext<Schema>(memoryProvider({ users }));
const remoteDb = createContext<Schema>(
  sqlProvider((async () => ({ rows: [] })) as SqlExecutor, schemaMeta),
);

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  enableFallback();
});

describe("without the build plugin", () => {
  it("the in-memory provider works fully — even with a captured closure", async () => {
    const minAge = 18;
    // No tree needed: memory calls the compiled function directly.
    const count = await memDb.users.where((u) => u.age >= minAge).count();
    expect(count).toBe(1);
  });

  it("a remote provider parses a closure-free lambda via the runtime fallback", async () => {
    const sql = await remoteDb.users.where((u) => u.age >= 18).explain();
    expect(sql).toContain("WHERE");
    expect(sql).toContain("$1");
  });

  it("a remote provider rejects a closure with a teachable R3002 error", async () => {
    const minAge = 18;
    // The fallback can't read closures from toString(); it names the variable and points to the plugin.
    await expect(remoteDb.users.where((u) => u.age >= minAge).explain()).rejects.toThrow(/R3002/);
    await expect(remoteDb.users.where((u) => u.age >= minAge).explain()).rejects.toThrow(/minAge/);
  });
});
