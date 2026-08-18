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

// A query context: rules only fire on receivers rooted at a createContext() result,
// so ordinary `arr.filter()`/`arr.map()` (same method names) stay untouched.
const CTX =
  'import { createContext } from "@greffon/query";\nconst db = createContext(provider);\n';

tester.run("valid-expression", validExpression as never, {
  valid: [
    `${CTX}db.users.filter(u => u.age > minAge);`,
    `${CTX}db.users.map(u => ({ id: u.id }));`,
    "expr(u => u.name.startsWith('A'));",
    // ordinary array methods with the same names — not a query context, ignored
    `${CTX}arr.map(u => u.x == 1);`,
    "rows.filter(r => r.x == 1);",
    // global-namespace statics that share query-operator names — ignored
    "Math.min(a => a.x == 1);",
  ],
  invalid: [
    {
      code: `${CTX}db.users.filter(u => u.id == 1);`,
      output: `${CTX}db.users.filter(u => u.id === 1);`,
      errors: [{ message: /R1103/ }],
    },
    {
      code: `${CTX}db.users.filter(u => { return u.age; });`,
      errors: [{ message: /R1101/ }],
    },
    {
      code: `${CTX}db.users.map(u => new Date(u.ts));`,
      errors: [{ message: /R1105/ }],
    },
  ],
});

tester.run("no-opaque-callback", noOpaqueCallback as never, {
  valid: [
    `${CTX}db.users.filter(u => u.active);`,
    `${CTX}db.users.filter(expr(pred));`,
    `${CTX}db.users.take(n);`,
    // ordinary array map with an opaque callback — not a query context, ignored
    `${CTX}rows.map(encode);`,
    // global-namespace statics that share query-operator names — ignored
    "Math.max(0, n);",
    "Math.min(cur, m);",
    "Object.groupBy(rows, keyOf);",
  ],
  invalid: [
    { code: `${CTX}db.users.filter(myPredicate);`, errors: [{ message: /R2003/ }] },
    { code: `${CTX}db.users.map(function (u) { return u.id; });`, errors: [{ message: /R2003/ }] },
  ],
});
