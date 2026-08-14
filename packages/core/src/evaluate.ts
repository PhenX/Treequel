import { type Node, TreequelError, isSpread } from "@treequel/tree";
import { REALM } from "./wellknown.js";

/** Bindings a tree is evaluated against. */
export interface EvalEnv {
  /** Lambda-parameter values, by param name. */
  readonly params?: Record<string, unknown>;
  /** Captured free-variable values (the result of an `Expr`'s `scope()` thunk). */
  readonly scope?: Record<string, unknown>;
}

/**
 * Interpret a tree directly. This is a reference interpreter — the memory
 * provider uses `expr.compiled` instead — but it backs partial evaluation and
 * the `evaluate(partialEval(t)) ≡ compiled(...)` property test.
 */
export function evaluate(n: Node, env: EvalEnv = {}): unknown {
  const params = env.params ?? {};
  const scope = env.scope ?? {};

  const ev = (node: Node): unknown => evaluate(node, env);

  switch (n.kind) {
    case "Param":
      return params[n.name];
    case "Capture":
      if (n.global) return REALM[n.name];
      return scope[n.name];
    case "Constant":
      return n.value;
    case "Member": {
      const obj = ev(n.object);
      if (n.optional && obj == null) return undefined;
      return (obj as Record<string, unknown>)[n.prop];
    }
    case "Index": {
      const obj = ev(n.object);
      if (n.optional && obj == null) return undefined;
      const idx = ev(n.index) as PropertyKey;
      return (obj as Record<PropertyKey, unknown>)[idx];
    }
    case "Call": {
      if (n.callee.kind === "Member") {
        const recv = ev(n.callee.object);
        if (n.callee.optional && recv == null) return undefined;
        const fn = (recv as Record<string, unknown>)?.[n.callee.prop];
        if (n.optional && fn == null) return undefined;
        if (typeof fn !== "function") {
          throw new TreequelError("R2001", `${n.callee.prop} is not a function on the receiver.`);
        }
        return (fn as (...a: unknown[]) => unknown).apply(recv, n.args.map(ev));
      }
      const fn = ev(n.callee);
      if (n.optional && fn == null) return undefined;
      if (typeof fn !== "function") {
        throw new TreequelError("R2001", `Callee is not a function.`);
      }
      return (fn as (...a: unknown[]) => unknown)(...n.args.map(ev));
    }
    case "Binary":
      return binary(n.op, ev(n.left), ev(n.right));
    case "Logical": {
      const left = ev(n.left);
      switch (n.op) {
        case "&&":
          return left && ev(n.right);
        case "||":
          return left || ev(n.right);
        case "??":
          return left ?? ev(n.right);
      }
      break;
    }
    case "Unary": {
      const v = n.op === "typeof" ? tryEval(() => ev(n.operand)) : ev(n.operand);
      switch (n.op) {
        case "!":
          return !v;
        case "-":
          return -(v as number);
        case "+":
          return +(v as number);
        case "typeof":
          return typeof v;
      }
      break;
    }
    case "Ternary":
      return ev(n.test) ? ev(n.then) : ev(n.else);
    case "Template": {
      let out = n.quasis[0] ?? "";
      for (let i = 0; i < n.exprs.length; i++) {
        out += String(ev(n.exprs[i] as Node)) + (n.quasis[i + 1] ?? "");
      }
      return out;
    }
    case "ObjectLit": {
      const obj: Record<string, unknown> = {};
      for (const p of n.props) {
        if (isSpread(p)) Object.assign(obj, ev(p.spread));
        else obj[p.key] = ev(p.value);
      }
      return obj;
    }
    case "ArrayLit": {
      const arr: unknown[] = [];
      for (const e of n.elements) {
        if (isSpread(e)) arr.push(...(ev(e.spread) as Iterable<unknown>));
        else arr.push(ev(e));
      }
      return arr;
    }
    case "Lambda":
      return (...args: unknown[]): unknown => {
        const inner: Record<string, unknown> = { ...params };
        n.params.forEach((name, i) => {
          inner[name] = args[i];
        });
        return evaluate(n.body, { params: inner, scope });
      };
    case "In": {
      const haystack = ev(n.haystack);
      const needle = ev(n.needle);
      if (Array.isArray(haystack)) return haystack.includes(needle);
      return (needle as PropertyKey) in (haystack as object);
    }
  }
}

function tryEval(f: () => unknown): unknown {
  try {
    return f();
  } catch {
    return undefined;
  }
}

function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "===":
      return l === r;
    case "!==":
      return l !== r;
    case "<":
      return (l as number) < (r as number);
    case "<=":
      return (l as number) <= (r as number);
    case ">":
      return (l as number) > (r as number);
    case ">=":
      return (l as number) >= (r as number);
    case "+":
      return (l as number) + (r as number);
    case "-":
      return (l as number) - (r as number);
    case "*":
      return (l as number) * (r as number);
    case "/":
      return (l as number) / (r as number);
    case "%":
      return (l as number) % (r as number);
    case "**":
      return (l as number) ** (r as number);
    case "instanceof":
      return l instanceof (r as new (...a: never[]) => unknown);
    case "in":
      return (l as PropertyKey) in (r as object);
    default:
      throw new TreequelError("R2001", `Unknown binary operator ${op}.`);
  }
}
