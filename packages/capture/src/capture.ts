import type { ArrayElement, Node, ObjectProp, Span } from "@treequel/tree";
import { type AstAdapter, type EsNode } from "./adapter.js";
import { type Diagnostic, makeDiagnostic } from "./diagnostics.js";

/** Identifiers treated as globals (→ `Capture{global:true}`), not free variables. */
export const GLOBALS_SAFELIST: readonly string[] = [
  "Math",
  "Number",
  "String",
  "Boolean",
  "Date",
  "JSON",
  "Array",
  "Object",
  "Infinity",
  "NaN",
  "undefined",
  "Intl",
  "BigInt",
];

export interface CaptureOptions {
  /** Extra identifier names to treat as globals. */
  readonly globals?: readonly string[];
}

export interface CaptureResult {
  /** Top-level parameter names (synthetic `$i` for destructured params). */
  readonly params: string[];
  /** The serialized body, or `null` when validation failed. */
  readonly body: Node | null;
  /** Free variables the emitted `scope()` thunk must close over, in first-seen order. */
  readonly freeVars: string[];
  readonly diagnostics: Diagnostic[];
}

const BINARY_OPS = new Set([
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "instanceof",
  "in",
]);
const UNARY_OPS = new Set(["!", "-", "+", "typeof"]);

type Resolver = (span?: Span) => Node;
type Frame = Map<string, Resolver>;

/**
 * The one shared implementation: validate an arrow against the subset grammar,
 * resolve parameter vs free-variable references, and serialize to a tree — in a
 * single walk. Consumed by the transform, the fallback, the LS plugin and
 * ESLint via an {@link AstAdapter}.
 */
export function capture(
  arrow: EsNode,
  adapter: AstAdapter,
  options: CaptureOptions = {},
): CaptureResult {
  const diagnostics: Diagnostic[] = [];
  const freeVars: string[] = [];
  const seenFree = new Set<string>();
  const globals = new Set<string>([...GLOBALS_SAFELIST, ...(options.globals ?? [])]);
  const scopeStack: Frame[] = [];

  const span = (n: EsNode): Span | undefined => adapter.span(n);
  const error = (code: string, n: EsNode, detail?: string): Node => {
    diagnostics.push(makeDiagnostic(code, span(n), detail));
    return { kind: "Constant", value: undefined };
  };

  const resolve = (name: string, at?: Span): Node => {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const r = scopeStack[i]?.get(name);
      if (r) return r(at);
    }
    if (globals.has(name)) return at ? { kind: "Capture", name, global: true, span: at } : { kind: "Capture", name, global: true };
    if (!seenFree.has(name)) {
      seenFree.add(name);
      freeVars.push(name);
    }
    return at ? { kind: "Capture", name, span: at } : { kind: "Capture", name };
  };

  // --- parameter binding --------------------------------------------------
  if (arrow.type !== "ArrowFunctionExpression") {
    diagnostics.push(makeDiagnostic("R1107", span(arrow)));
    return { params: [], body: null, freeVars, diagnostics };
  }

  const rawParams = (arrow.params as EsNode[] | undefined) ?? [];
  const frame: Frame = new Map();
  const params = bindParams(rawParams, frame, diagnostics, span);
  scopeStack.push(frame);

  // --- body ---------------------------------------------------------------
  const bodyNode = arrow.body as EsNode;
  let body: Node | null;
  if (bodyNode.type === "BlockStatement") {
    diagnostics.push(makeDiagnostic("R1101", span(bodyNode)));
    body = null;
  } else {
    body = build(bodyNode);
  }

  scopeStack.pop();

  return {
    params,
    body: diagnostics.some((d) => d.severity === "error") ? null : body,
    freeVars,
    diagnostics,
  };

  // --- recursive builder --------------------------------------------------
  function build(node: EsNode): Node {
    const n = unwrap(node);
    const at = span(n);
    switch (n.type) {
      case "Identifier":
        return resolve(n.name as string, at);
      case "Literal":
        return literal(n, at);
      case "TemplateLiteral":
        return template(n, at);
      case "TaggedTemplateExpression":
        return error("R1108", n);
      case "MemberExpression":
        return member(n, at);
      case "CallExpression":
        return call(n, at);
      case "NewExpression":
        return error("R1105", n);
      case "BinaryExpression":
        return binary(n, at);
      case "LogicalExpression": {
        const op = n.operator as string;
        if (op !== "&&" && op !== "||" && op !== "??") return error("R1100", n, op);
        return withSpan({ kind: "Logical", op, left: build(n.left as EsNode), right: build(n.right as EsNode) }, at);
      }
      case "UnaryExpression": {
        const op = n.operator as string;
        if (!UNARY_OPS.has(op)) return error("R1100", n, `unary ${op}`);
        return withSpan({ kind: "Unary", op: op as "!" | "-" | "+" | "typeof", operand: build(n.argument as EsNode) }, at);
      }
      case "UpdateExpression":
        return error("R1102", n, n.operator as string);
      case "AssignmentExpression":
        return error("R1102", n, n.operator as string);
      case "ConditionalExpression":
        return withSpan(
          {
            kind: "Ternary",
            test: build(n.test as EsNode),
            then: build(n.consequent as EsNode),
            else: build(n.alternate as EsNode),
          },
          at,
        );
      case "SequenceExpression":
        return error("R1110", n);
      case "ArrayExpression":
        return array(n, at);
      case "ObjectExpression":
        return object(n, at);
      case "ArrowFunctionExpression":
        return lambda(n, at);
      case "FunctionExpression":
      case "FunctionDeclaration":
        return error("R1107", n);
      case "ThisExpression":
        return error("R1104", n);
      case "AwaitExpression":
      case "YieldExpression":
        return error("R1106", n);
      default:
        return error("R1100", n, n.type);
    }
  }

  function literal(n: EsNode, at?: Span): Node {
    if (n.regex) return error("R1109", n);
    const value = n.value;
    if (typeof value === "bigint") return withSpan({ kind: "Constant", value }, at);
    return withSpan({ kind: "Constant", value: value as unknown }, at);
  }

  function template(n: EsNode, at?: Span): Node {
    const quasis = (n.quasis as EsNode[]).map((q) => {
      const cooked = (q.value as { cooked?: string; raw?: string } | undefined)?.cooked;
      return cooked ?? "";
    });
    const exprs = (n.expressions as EsNode[]).map(build);
    return withSpan({ kind: "Template", quasis, exprs }, at);
  }

  function member(n: EsNode, at?: Span): Node {
    const object = build(n.object as EsNode);
    const optional = n.optional === true ? (true as const) : undefined;
    if (n.computed) {
      return withSpan(
        optional
          ? { kind: "Index", object, index: build(n.property as EsNode), optional }
          : { kind: "Index", object, index: build(n.property as EsNode) },
        at,
      );
    }
    const prop = n.property as EsNode;
    if (prop.type !== "Identifier") return error("R1100", n, "computed/private member");
    return withSpan(
      optional
        ? { kind: "Member", object, prop: prop.name as string, optional }
        : { kind: "Member", object, prop: prop.name as string },
      at,
    );
  }

  function call(n: EsNode, at?: Span): Node {
    const args: Node[] = [];
    for (const a of n.arguments as EsNode[]) {
      if (a.type === "SpreadElement") {
        error("R1100", a, "spread in call arguments");
        continue;
      }
      args.push(build(a));
    }
    const optional = n.optional === true ? (true as const) : undefined;
    const callee = build(n.callee as EsNode);
    return withSpan(optional ? { kind: "Call", callee, args, optional } : { kind: "Call", callee, args }, at);
  }

  function binary(n: EsNode, at?: Span): Node {
    const op = n.operator as string;
    if (op === "==" || op === "!=") return error("R1103", n, op);
    if (!BINARY_OPS.has(op)) return error("R1100", n, op);
    return withSpan(
      { kind: "Binary", op: op as "===", left: build(n.left as EsNode), right: build(n.right as EsNode) },
      at,
    );
  }

  function array(n: EsNode, at?: Span): Node {
    const elements: ArrayElement[] = (n.elements as (EsNode | null)[]).map((e) => {
      if (e === null) return { kind: "Constant", value: undefined } as Node;
      if (e.type === "SpreadElement") return { spread: build(e.argument as EsNode) };
      return build(e);
    });
    return withSpan({ kind: "ArrayLit", elements }, at);
  }

  function object(n: EsNode, at?: Span): Node {
    const props: ObjectProp[] = [];
    for (const p of n.properties as EsNode[]) {
      if (p.type === "SpreadElement") {
        props.push({ spread: build(p.argument as EsNode) });
        continue;
      }
      if (p.type !== "Property") {
        error("R1100", p, p.type);
        continue;
      }
      if (p.kind !== "init" || p.method) {
        error("R1100", p, "getter/setter/method in object literal");
        continue;
      }
      const key = keyName(p);
      if (key === null) {
        error("R1100", p, "computed object key");
        continue;
      }
      props.push({ key, value: build(p.value as EsNode) });
    }
    return withSpan({ kind: "ObjectLit", props }, at);
  }

  function lambda(n: EsNode, at?: Span): Node {
    if (n.body && (n.body as EsNode).type === "BlockStatement") {
      return error("R1101", n.body as EsNode);
    }
    const frame: Frame = new Map();
    const names = bindParams((n.params as EsNode[]) ?? [], frame, diagnostics, span, /* nested */ true);
    scopeStack.push(frame);
    const bodyN = build(n.body as EsNode);
    scopeStack.pop();
    return withSpan({ kind: "Lambda", params: names, body: bodyN }, at);
  }
}

function keyName(p: EsNode): string | null {
  if (p.computed) return null;
  const key = p.key as EsNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal") return String(key.value);
  return null;
}

function withSpan(node: Node, at?: Span): Node {
  return at ? ({ ...node, span: at } as Node) : node;
}

/** Bind a parameter list into `frame`, returning the tree-level parameter names. */
function bindParams(
  rawParams: readonly EsNode[],
  frame: Frame,
  diagnostics: Diagnostic[],
  span: (n: EsNode) => Span | undefined,
  nested = false,
): string[] {
  const names: string[] = [];
  rawParams.forEach((p, i) => {
    switch (p.type) {
      case "Identifier": {
        const name = p.name as string;
        frame.set(name, (at) => (at ? { kind: "Param", name, span: at } : { kind: "Param", name }));
        names.push(name);
        break;
      }
      case "ObjectPattern": {
        if (nested) {
          diagnostics.push(makeDiagnostic("R1111", span(p), "destructuring in a nested lambda"));
          names.push(`$${i}`);
          break;
        }
        const root = `$${i}`;
        names.push(root);
        for (const prop of p.properties as EsNode[]) {
          if (prop.type === "RestElement") {
            diagnostics.push(makeDiagnostic("R1111", span(prop), "rest element in destructuring"));
            continue;
          }
          if (prop.type !== "Property") {
            diagnostics.push(makeDiagnostic("R1100", span(prop), prop.type));
            continue;
          }
          const key = keyName(prop);
          if (key === null) {
            diagnostics.push(makeDiagnostic("R1100", span(prop), "computed destructuring key"));
            continue;
          }
          const value = prop.value as EsNode;
          if (value.type === "AssignmentPattern") {
            diagnostics.push(makeDiagnostic("R1112", span(value)));
            continue;
          }
          if (value.type !== "Identifier") {
            diagnostics.push(makeDiagnostic("R1100", span(value), "nested destructuring"));
            continue;
          }
          const local = value.name as string;
          frame.set(local, (at) => ({
            kind: "Member",
            object: { kind: "Param", name: root },
            prop: key,
            ...(at ? { span: at } : {}),
          }));
        }
        break;
      }
      case "ArrayPattern":
        diagnostics.push(makeDiagnostic("R1111", span(p), "array-destructured parameter"));
        names.push(`$${i}`);
        break;
      case "RestElement":
        diagnostics.push(makeDiagnostic("R1111", span(p), "rest parameter"));
        names.push(`$${i}`);
        break;
      case "AssignmentPattern":
        diagnostics.push(makeDiagnostic("R1112", span(p)));
        names.push(`$${i}`);
        break;
      default:
        diagnostics.push(makeDiagnostic("R1100", span(p), p.type));
        names.push(`$${i}`);
    }
  });
  return names;
}

/** Strip TS-only wrapper syntax and optional-chain wrappers. */
function unwrap(node: EsNode): EsNode {
  let n = node;
  for (;;) {
    switch (n.type) {
      case "ChainExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
      case "ParenthesizedExpression":
        n = n.expression as EsNode;
        break;
      default:
        return n;
    }
  }
}
