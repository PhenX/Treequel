/**
 * The single error type thrown across the Greffon runtime.
 *
 * `tree` is the root of the dependency graph (zero deps), so its error type is
 * shared by every package. Each error carries a stable `Rxxxx` diagnostic code
 * (see the catalog in `@greffon/capture`) so messages stay greppable and can
 * be linked to `https://greffon.dev/errors#<code>`.
 */
export class GreffonError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "GreffonError";
    this.code = code;
  }
}

export function docsUrl(code: string): string {
  return `https://greffon.dev/errors#${code}`;
}
