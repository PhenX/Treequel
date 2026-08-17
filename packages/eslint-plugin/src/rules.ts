import { adapterTsestree, capture } from "@treequel/capture";
import { QUERY_METHODS } from "./methods.js";

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

/** Import sources whose `createContext` roots a query context. */
const TRACED_PACKAGES: ReadonlySet<string> = new Set(["@treequel/query"]);

/** Global namespaces whose static methods share query-operator names (`Math.min`, `Object.groupBy`). */
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

/** Peel the type-only and grouping wrappers a receiver expression may carry. */
function unwrap(node: AstNode): AstNode {
  let cur = node;
  while (
    cur &&
    (cur.type === "TSAsExpression" ||
      cur.type === "TSSatisfiesExpression" ||
      cur.type === "TSNonNullExpression" ||
      cur.type === "TSTypeAssertion" ||
      cur.type === "ChainExpression")
  ) {
    cur = cur.expression as AstNode;
  }
  return cur;
}

function walk(node: unknown, enter: (n: AstNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, enter);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type === "string") enter(n as unknown as AstNode);
  for (const key in n) {
    if (key === "parent" || key === "type") continue;
    const v = n[key];
    if (v && typeof v === "object") walk(v, enter);
  }
}

/**
 * Intra-module taint: a receiver is a query context when it roots at a
 * `createContext()` result — the same rule the build transform reifies against.
 * Names query methods after `Array` methods, so matching by method name alone
 * would flag ordinary `array.map()`/`array.filter()` calls; the receiver taint
 * is what tells `db.users.filter(…)` apart from `rows.filter(…)`.
 */
function computeTaint(program: AstNode): (node: AstNode) => boolean {
  const createLocals = new Set<string>();
  const namespaceLocals = new Set<string>();
  for (const stmt of (program.body as AstNode[]) ?? []) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = (stmt.source as { value?: string })?.value;
    if (!source || !TRACED_PACKAGES.has(source)) continue;
    for (const spec of (stmt.specifiers as AstNode[]) ?? []) {
      const local = (spec.local as { name: string } | undefined)?.name;
      if (!local) continue;
      if (spec.type === "ImportNamespaceSpecifier") namespaceLocals.add(local);
      else if (
        spec.type === "ImportSpecifier" &&
        (spec.imported as { name?: string }).name === "createContext"
      ) {
        createLocals.add(local);
      }
    }
  }

  const isCreateContextCall = (n: AstNode): boolean => {
    const callee = unwrap(n.callee as AstNode);
    if (callee.type === "Identifier") return createLocals.has(callee.name as string);
    if (callee.type === "MemberExpression") {
      const obj = unwrap(callee.object as AstNode);
      const prop = callee.property as AstNode;
      return (
        obj.type === "Identifier" &&
        namespaceLocals.has(obj.name as string) &&
        prop?.type === "Identifier" &&
        prop.name === "createContext"
      );
    }
    return false;
  };

  const taint = new Set<string>();
  const declarators: Array<{ name: string; init: AstNode }> = [];
  walk(program, (n) => {
    if (n.type === "VariableDeclarator" && (n.id as AstNode)?.type === "Identifier" && n.init) {
      declarators.push({ name: (n.id as { name: string }).name, init: n.init as AstNode });
    }
  });

  const isTainted = (node: AstNode): boolean => {
    const n = unwrap(node);
    switch (n.type) {
      case "Identifier":
        return taint.has(n.name as string);
      case "MemberExpression":
        return isTainted(n.object as AstNode);
      case "CallExpression":
        return isCreateContextCall(n) || isTainted(n.callee as AstNode);
      case "ConditionalExpression":
        return isTainted(n.consequent as AstNode) && isTainted(n.alternate as AstNode);
      default:
        return false;
    }
  };

  // Fixpoint so `const a = db.users; const q = a.filter(...)` both taint.
  for (let changed = true; changed;) {
    changed = false;
    for (const d of declarators) {
      if (!taint.has(d.name) && isTainted(d.init)) {
        taint.add(d.name);
        changed = true;
      }
    }
  }
  return isTainted;
}

/** A call of a query method on a query-context receiver (not `Math.min`, not a plain array). */
function isQueryMethodCall(call: AstNode, isTainted: (n: AstNode) => boolean): boolean {
  const callee = call.callee as AstNode | undefined;
  if (callee?.type !== "MemberExpression") return false;
  const obj = unwrap(callee.object as AstNode);
  if (obj.type === "Identifier" && GLOBAL_NAMESPACES.has(obj.name as string)) return false;
  const prop = callee.property as AstNode;
  if (prop?.type !== "Identifier" || !QUERY_METHODS.has(prop.name as string)) return false;
  return isTainted(callee.object as AstNode);
}

/** Is `arrow` a lambda literal written directly at a query call site or in expr()? */
function isQueryLambdaArg(arrow: AstNode, isTainted: (n: AstNode) => boolean): boolean {
  const parent = arrow.parent;
  if (!parent || parent.type !== "CallExpression") return false;
  const args = (parent.arguments as AstNode[]) ?? [];
  if (!args.includes(arrow)) return false;
  const callee = parent.callee as AstNode;
  if (callee.type === "Identifier" && callee.name === "expr") return true;
  return isQueryMethodCall(parent, isTainted);
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
    let isTainted: (n: AstNode) => boolean = () => false;

    return {
      Program(node) {
        isTainted = computeTaint(node);
      },
      ArrowFunctionExpression(node) {
        if (!isQueryLambdaArg(node, isTainted)) return;
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
    let isTainted: (n: AstNode) => boolean = () => false;
    return {
      Program(node) {
        isTainted = computeTaint(node);
      },
      CallExpression(node) {
        if (!isQueryMethodCall(node, isTainted)) return;
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
