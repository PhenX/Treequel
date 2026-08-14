import { type Node, type NodeKind, isSpread } from "@treequel/tree";

/**
 * The three traversal primitives. Everything downstream — partial eval,
 * printers, SQL translation, capability checks — is built on these.
 */

/** Uniform child extraction, in evaluation order. */
export function children(n: Node): Node[] {
  switch (n.kind) {
    case "Param":
    case "Capture":
    case "Constant":
      return [];
    case "Member":
      return [n.object];
    case "Index":
      return [n.object, n.index];
    case "Call":
      return [n.callee, ...n.args];
    case "Binary":
    case "Logical":
      return [n.left, n.right];
    case "Unary":
      return [n.operand];
    case "Ternary":
      return [n.test, n.then, n.else];
    case "Template":
      return [...n.exprs];
    case "ObjectLit":
      return n.props.map((p) => (isSpread(p) ? p.spread : p.value));
    case "ArrayLit":
      return n.elements.map((e) => (isSpread(e) ? e.spread : e));
    case "Lambda":
      return [n.body];
    case "In":
      return [n.needle, n.haystack];
  }
}

/**
 * Apply `f` to every immediate child, rebuilding the node only when something
 * changed (structural sharing). The workhorse behind {@link rewrite}.
 */
export function mapChildren(n: Node, f: (child: Node) => Node): Node {
  switch (n.kind) {
    case "Param":
    case "Capture":
    case "Constant":
      return n;
    case "Member": {
      const object = f(n.object);
      return object === n.object ? n : { ...n, object };
    }
    case "Index": {
      const object = f(n.object);
      const index = f(n.index);
      return object === n.object && index === n.index ? n : { ...n, object, index };
    }
    case "Call": {
      const callee = f(n.callee);
      const args = mapArray(n.args, f);
      return callee === n.callee && args === n.args ? n : { ...n, callee, args };
    }
    case "Binary":
    case "Logical": {
      const left = f(n.left);
      const right = f(n.right);
      return left === n.left && right === n.right ? n : { ...n, left, right };
    }
    case "Unary": {
      const operand = f(n.operand);
      return operand === n.operand ? n : { ...n, operand };
    }
    case "Ternary": {
      const test = f(n.test);
      const then = f(n.then);
      const els = f(n.else);
      return test === n.test && then === n.then && els === n.else
        ? n
        : { ...n, test, then, else: els };
    }
    case "Template": {
      const exprs = mapArray(n.exprs, f);
      return exprs === n.exprs ? n : { ...n, exprs };
    }
    case "ObjectLit": {
      let changed = false;
      const props = n.props.map((p) => {
        if (isSpread(p)) {
          const spread = f(p.spread);
          if (spread !== p.spread) changed = true;
          return spread === p.spread ? p : { spread };
        }
        const value = f(p.value);
        if (value !== p.value) changed = true;
        return value === p.value ? p : { key: p.key, value };
      });
      return changed ? { ...n, props } : n;
    }
    case "ArrayLit": {
      let changed = false;
      const elements = n.elements.map((e) => {
        if (isSpread(e)) {
          const spread = f(e.spread);
          if (spread !== e.spread) changed = true;
          return spread === e.spread ? e : { spread };
        }
        const el = f(e);
        if (el !== e) changed = true;
        return el;
      });
      return changed ? { ...n, elements } : n;
    }
    case "Lambda": {
      const body = f(n.body);
      return body === n.body ? n : { ...n, body };
    }
    case "In": {
      const needle = f(n.needle);
      const haystack = f(n.haystack);
      return needle === n.needle && haystack === n.haystack ? n : { ...n, needle, haystack };
    }
  }
}

function mapArray(arr: readonly Node[], f: (n: Node) => Node): readonly Node[] {
  let changed = false;
  const out = arr.map((x) => {
    const y = f(x);
    if (y !== x) changed = true;
    return y;
  });
  return changed ? out : arr;
}

export type VisitFns = {
  [K in NodeKind]?: (n: Extract<Node, { kind: K }>) => void;
};

export type RewriteFns = {
  [K in NodeKind]?: (n: Extract<Node, { kind: K }>) => Node | undefined;
};

/** Pre-order walk; invoke `fns[kind]` for each visited node. */
export function visit(n: Node, fns: VisitFns): void {
  const fn = fns[n.kind] as ((node: Node) => void) | undefined;
  if (fn) fn(n);
  for (const c of children(n)) visit(c, fns);
}

/**
 * Bottom-up rewrite: children first, then the node's own handler. Returns a new
 * tree, sharing structure wherever nothing changed. A handler returning
 * `undefined` leaves the (already child-rewritten) node in place.
 */
export function rewrite(n: Node, fns: RewriteFns): Node {
  const mapped = mapChildren(n, (c) => rewrite(c, fns));
  const fn = fns[mapped.kind] as ((node: Node) => Node | undefined) | undefined;
  if (fn) {
    const replaced = fn(mapped);
    if (replaced !== undefined) return replaced;
  }
  return mapped;
}
