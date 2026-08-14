import parser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noOpaqueCallback, validExpression } from "./rules.js";

// Bridge RuleTester's lifecycle to Vitest.
RuleTester.describe = describe as never;
RuleTester.it = it as never;
RuleTester.itOnly = it.only as never;

const tester = new RuleTester({
  languageOptions: { parser: parser as never, ecmaVersion: 2022, sourceType: "module" },
});

tester.run("valid-expression", validExpression as never, {
  valid: [
    "db.users.where(u => u.age > minAge);",
    "db.users.select(u => ({ id: u.id }));",
    "expr(u => u.name.startsWith('A'));",
    // not a query lambda — ignored
    "arr.map(u => u.x == 1);",
  ],
  invalid: [
    {
      code: "db.users.where(u => u.id == 1);",
      output: "db.users.where(u => u.id === 1);",
      errors: [{ message: /R1103/ }],
    },
    {
      code: "db.users.where(u => { return u.age; });",
      errors: [{ message: /R1101/ }],
    },
    {
      code: "db.users.select(u => new Date(u.ts));",
      errors: [{ message: /R1105/ }],
    },
  ],
});

tester.run("no-opaque-callback", noOpaqueCallback as never, {
  valid: ["db.users.where(u => u.active);", "db.users.where(expr(pred));", "db.users.take(n);"],
  invalid: [
    { code: "db.users.where(myPredicate);", errors: [{ message: /R2003/ }] },
    { code: "db.users.select(function (u) { return u.id; });", errors: [{ message: /R2003/ }] },
  ],
});
