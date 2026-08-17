import { type Node, FORMAT_VERSION } from "@treequel/tree";
import { evaluate } from "./evaluate.js";
import { type Expr, __expr } from "./expr.js";

/** Options for {@link makeExpr}; every field is optional. */
export interface MakeExprOptions<F extends (...a: never[]) => unknown> {
  /** Captured free-variable values, read at execution time (default: none). */
  readonly scope?: () => Record<string, unknown>;
  /**
   * The executable form. Defaults to the reference interpreter over `body`, so a
   * hand-built expression runs in the memory provider with no second function to
   * keep in sync. Pass one when you have a faster or closure-bound equivalent.
   */
  readonly compiled?: F;
  /** Source text for `toString()`/inspection (default: the printed tree). */
  readonly src?: string;
  /** Origin `file:line:col`, surfaced in provider diagnostics. */
  readonly loc?: string;
}

/**
 * Build an `Expr` from a tree assembled by hand — via the `b` node builders,
 * `deserialize`, or a `rewrite` pass — instead of from a reified lambda. The
 * counterpart to `expr(fn)`: that path starts from a function and derives the
 * tree; this one starts from a tree and derives the function.
 *
 * ```ts
 * const isAdult = makeExpr<(u: User) => boolean>(
 *   ["u"],
 *   b.binary(">", b.member(b.param("u"), "age"), b.const(18)),
 * );
 * db.users.filter(isAdult); // SQL reads `body`; memory calls `compiled`
 * ```
 */
export function makeExpr<F extends (...a: never[]) => unknown>(
  params: readonly string[],
  body: Node,
  options: MakeExprOptions<F> = {},
): Expr<F> {
  const scope = options.scope ?? ((): Record<string, unknown> => ({}));
  const compiled =
    options.compiled ??
    (((...args: unknown[]): unknown => {
      const bindings: Record<string, unknown> = {};
      params.forEach((name, i) => {
        bindings[name] = args[i];
      });
      return evaluate(body, { params: bindings, scope: scope() });
    }) as unknown as F);
  return __expr<F>({
    v: FORMAT_VERSION,
    params,
    body,
    scope,
    compiled,
    ...(options.src !== undefined ? { src: options.src } : {}),
    ...(options.loc !== undefined ? { loc: options.loc } : {}),
  });
}
