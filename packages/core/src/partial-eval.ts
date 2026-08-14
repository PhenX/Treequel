import type { Node } from "@treequel/tree";
import { evaluate } from "./evaluate.js";
import { mapChildren, children } from "./visitor.js";

/**
 * Does `n` reference a lambda parameter that is free with respect to `bound`?
 * Nested `Lambda` nodes extend the bound set for their own body, so a nested
 * arrow that only touches its own params + captures counts as closed.
 */
function hasFreeParam(n: Node, bound: ReadonlySet<string>): boolean {
  switch (n.kind) {
    case "Param":
      return !bound.has(n.name);
    case "Lambda": {
      const inner = new Set(bound);
      for (const p of n.params) inner.add(p);
      return hasFreeParam(n.body, inner);
    }
    default:
      return children(n).some((c) => hasFreeParam(c, bound));
  }
}

const EMPTY: ReadonlySet<string> = new Set();

/** A subtree is *closed* (evaluable now) iff it references no row parameter. */
export function isClosed(n: Node): boolean {
  return !hasFreeParam(n, EMPTY);
}

/**
 * Fold every maximal closed subtree to a `Constant` by evaluating it against
 * captured `scope` values. `Lambda` nodes are never folded to a value (a stored
 * closure could not serialize and providers must still see `some`/`every`
 * structurally); instead we recurse into their bodies.
 *
 * If evaluation throws (e.g. reading a member of `undefined`), the subtree is
 * left intact and we recurse structurally — folding is an optimization, never a
 * place to surface runtime errors early.
 */
export function foldConstants(node: Node, scope: Record<string, unknown>): Node {
  const fold = (n: Node): Node => {
    if (n.kind !== "Lambda" && isClosed(n)) {
      try {
        return { kind: "Constant", value: evaluate(n, { scope }) };
      } catch {
        // fall through to structural recursion
      }
    }
    return mapChildren(n, fold);
  };
  return fold(node);
}

/** Input to {@link partialEval}: anything Expr-shaped, or a bare `{ body }`. */
export interface PartialEvalInput {
  readonly body: Node;
  readonly scope?: () => Record<string, unknown>;
}

/**
 * The public entry providers call first, always: resolve captures against the
 * live `scope()` and fold, leaving a residual tree of param-rooted data access,
 * constants, and operations over them.
 */
export function partialEval(input: PartialEvalInput): Node {
  const scope = input.scope ? input.scope() : {};
  return foldConstants(input.body, scope);
}
