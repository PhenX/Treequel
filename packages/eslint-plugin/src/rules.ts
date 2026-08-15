import { adapterTsestree, capture } from "@treequel/capture";
import { LINQ_METHODS } from "./methods.js";

/* eslint-env node */
// Minimal structural typings — we avoid a hard dep on @typescript-eslint/utils.
interface AstNode {
  type: string;
  parent?: AstNode;
  [key: string]: unknown;
}
interface Token {
  value: string;
  range: [number, number];
}
interface SourceCode {
  getLocFromIndex(index: number): { line: number; column: number };
  getTokenAfter(node: unknown, opts: { filter: (t: Token) => boolean }): Token | null;
}
interface RuleContext {
  sourceCode?: SourceCode;
  getSourceCode(): SourceCode;
  report(descriptor: unknown): void;
}
export interface Rule {
  meta: Record<string, unknown>;
  create(context: RuleContext): Record<string, (node: AstNode) => void>;
}

/** Global namespaces whose static methods collide with query-operator names (`Math.min`, `Object.groupBy`). */
const GLOBAL_NAMESPACES: ReadonlySet<string> = new Set([
  "Math",
  "Object",
  "JSON",
  "Number",
  "Date",
  "Promise",
  "Reflect",
  "Symbol",
  "Intl",
  "Atomics",
]);

function calleeMethodName(call: AstNode): string | null {
  const callee = call.callee as AstNode | undefined;
  if (callee?.type === "MemberExpression") {
    const obj = callee.object as AstNode;
    if (obj?.type === "Identifier" && GLOBAL_NAMESPACES.has(obj.name as string)) return null;
    const prop = callee.property as AstNode;
    if (prop?.type === "Identifier") return prop.name as string;
  }
  return null;
}

/** Is `arrow` a lambda literal written directly at a traced query call site or in expr()? */
function isQueryLambdaArg(arrow: AstNode): boolean {
  const parent = arrow.parent;
  if (!parent || parent.type !== "CallExpression") return false;
  const args = (parent.arguments as AstNode[]) ?? [];
  if (!args.includes(arrow)) return false;
  const callee = parent.callee as AstNode;
  if (callee.type === "Identifier" && callee.name === "expr") return true;
  const method = calleeMethodName(parent);
  return method !== null && LINQ_METHODS.has(method);
}

function hasQueryLambdaAncestor(node: AstNode, set: WeakSet<AstNode>): boolean {
  let cur: AstNode | undefined = node.parent;
  while (cur) {
    if (set.has(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** `treequel/valid-expression` — reports subset violations from the shared validator. */
export const validExpression: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Enforce the Treequel expression-lambda subset." },
    fixable: "code",
    schema: [],
  },
  create(context) {
    const sc = context.sourceCode ?? context.getSourceCode();
    const queryLambdas = new WeakSet<AstNode>();

    return {
      ArrowFunctionExpression(node) {
        if (!isQueryLambdaArg(node)) return;
        queryLambdas.add(node);
        const result = capture(node as never, adapterTsestree);
        for (const d of result.diagnostics) {
          if (d.code === "R1103") continue; // reported with an autofix on the BinaryExpression
          context.report({
            loc: d.span
              ? { start: sc.getLocFromIndex(d.span.start), end: sc.getLocFromIndex(d.span.end) }
              : (node.loc as unknown),
            message: `${d.code}: ${d.message}${d.hint ? ` — ${d.hint}` : ""}`,
          });
        }
      },
      BinaryExpression(node) {
        const op = node.operator as string;
        if (op !== "==" && op !== "!=") return;
        if (!hasQueryLambdaAncestor(node, queryLambdas)) return;
        context.report({
          node: node as unknown,
          message: `R1103: Loose equality (${op}) is not allowed — use ${op === "==" ? "===" : "!=="}.`,
          fix(fixer: { replaceText(t: Token, text: string): unknown }) {
            const token = sc.getTokenAfter(node.left, { filter: (t) => t.value === op });
            return token ? fixer.replaceText(token, op === "==" ? "===" : "!==") : null;
          },
        });
      },
    };
  },
};

/** `treequel/no-opaque-callback` — flags function *references* passed to query methods (the boundary rule). */
export const noOpaqueCallback: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Query lambdas must be written inline or wrapped with expr()." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const method = calleeMethodName(node);
        if (method === null || !LINQ_METHODS.has(method)) return;
        for (const arg of (node.arguments as AstNode[]) ?? []) {
          if (arg.type === "Identifier" || arg.type === "FunctionExpression") {
            context.report({
              node: arg as unknown,
              message:
                "R2003: Opaque function passed to a query method — write the lambda inline, or wrap it with expr().",
            });
          }
        }
      },
    };
  },
};
