import { type Node, FORMAT_VERSION, TreequelError } from "@treequel/tree";
import { print } from "./printer.js";

declare const brand: unique symbol;

/**
 * The dual of a query lambda: an executable function (`compiled`) that is
 * *also* a serializable, typed expression tree (`body`).
 *
 * The phantom `[brand]` property carries the function type `F` for inference
 * without existing at runtime; it is optional so structural fakes can't crash
 * inspection.
 */
export interface Expr<F extends (...a: never[]) => unknown> {
  readonly [brand]?: F;
  readonly params: readonly string[];
  readonly body: Node;
  readonly scope: () => Record<string, unknown>;
  readonly compiled: F;
  readonly src?: string;
  readonly loc?: string;
}

const IS_EXPR: unique symbol = Symbol.for("treequel.isExpr") as never;
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** Runtime guard: was `x` produced by `__expr`/`expr`? */
export function isExpr(x: unknown): x is Expr<(...a: never[]) => unknown> {
  return typeof x === "object" && x !== null && (x as Record<symbol, unknown>)[IS_EXPR] === true;
}

/** The object shape the build transform emits. */
export interface ExprInit<F extends (...a: never[]) => unknown> {
  readonly v: number;
  readonly compiled: F;
  readonly params: readonly string[];
  readonly body: Node;
  readonly scope: () => Record<string, unknown>;
  readonly src?: string;
  readonly loc?: string;
}

function brandExpr<F extends (...a: never[]) => unknown>(e: Record<string, unknown>): Expr<F> {
  Object.defineProperty(e, IS_EXPR, { value: true, enumerable: false });
  Object.defineProperty(e, "toString", {
    value(this: Expr<F>): string {
      return this.src ?? print(this.body);
    },
    enumerable: false,
  });
  Object.defineProperty(e, INSPECT, {
    value(this: Expr<F>): string {
      return `Expr ${this.src ?? print(this.body)}`;
    },
    enumerable: false,
  });
  return e as unknown as Expr<F>;
}

/**
 * The runtime host the transform splices in place of a traced lambda. O(1):
 * validate the format version, brand, freeze, return. No parsing.
 */
export function __expr<F extends (...a: never[]) => unknown>(init: ExprInit<F>): Expr<F> {
  if (init.v !== FORMAT_VERSION) {
    throw new TreequelError(
      "R1901",
      `Emitted expression has format v${init.v}; this runtime is v${FORMAT_VERSION}. Align @treequel/core and the build plugin versions.`,
    );
  }
  const e = brandExpr<F>({
    params: init.params,
    body: init.body,
    scope: init.scope,
    compiled: init.compiled,
    ...(init.src !== undefined ? { src: init.src } : {}),
    ...(init.loc !== undefined ? { loc: init.loc } : {}),
  });
  return Object.freeze(e);
}

// --- Runtime fallback wiring (no static edge to @treequel/fallback) ---------

/** What the fallback package produces from `f.toString()`. */
export type FallbackHost = (f: (...a: never[]) => unknown) => {
  readonly params: readonly string[];
  readonly body: Node;
  readonly scope: () => Record<string, unknown>;
};

let fallbackHost: FallbackHost | undefined;

/** Called by `@treequel/fallback` on import to enable runtime `toString()` capture. */
export function __setFallbackHost(host: FallbackHost): void {
  fallbackHost = host;
}

/**
 * The escape hatch. At a traced call site the transform rewrites `expr(f)` into
 * `__expr({...})`, so this body only runs when the plugin did not process the
 * module. Then the tree is derived lazily via the runtime fallback — but only
 * if a provider actually reads `body` (the memory provider never does, so
 * closure-capturing lambdas still work in memory).
 */
export function expr<F extends (...a: never[]) => unknown>(f: F): Expr<F> {
  let cache: { params: readonly string[]; body: Node; scope: () => Record<string, unknown> } | undefined;
  const derive = (): NonNullable<typeof cache> => {
    if (cache) return cache;
    if (!fallbackHost) {
      throw new TreequelError(
        "R3001",
        "No expression tree is available for this lambda. Enable the @treequel/vite build plugin, " +
          'or `import "@treequel/fallback/register"` to allow runtime toString() parsing. ' +
          "(The in-memory provider does not need either.)",
      );
    }
    cache = fallbackHost(f);
    return cache;
  };
  const e = brandExpr<F>({
    compiled: f,
    get params(): readonly string[] {
      return derive().params;
    },
    get body(): Node {
      return derive().body;
    },
    get scope(): () => Record<string, unknown> {
      return derive().scope;
    },
  });
  return e;
}
