/**
 * The single error type thrown across the Treequel runtime.
 *
 * `tree` is the root of the dependency graph (zero deps), so its error type is
 * shared by every package. Each error carries a stable `Rxxxx` diagnostic code
 * (see the catalog in `@treequel/capture`) so messages stay greppable and can
 * be linked to `https://treequel.dev/errors#<code>`.
 */
export class TreequelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "TreequelError";
    this.code = code;
  }
}

export function docsUrl(code: string): string {
  return `https://treequel.dev/errors#${code}`;
}
