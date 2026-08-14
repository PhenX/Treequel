import type { Span } from "@treequel/tree";

/**
 * A parser-agnostic ESTree node. Both oxc-parser (build transform) and
 * `@typescript-eslint`/meriyah (lint + fallback) emit ESTree-compatible trees,
 * so capture reads standard ESTree properties directly; the {@link AstAdapter}
 * only abstracts the handful of things that differ — chiefly source spans.
 */
export interface EsNode {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly range?: readonly [number, number];
  readonly [key: string]: unknown;
}

/**
 * The minimal seam that lets one capture implementation serve four hosts
 * (transform, fallback, LS plugin, ESLint).
 */
export interface AstAdapter {
  readonly name: string;
  /** Source offsets of a node, if the parser recorded them. */
  span(node: EsNode): Span | undefined;
}

function spanOf(node: EsNode): Span | undefined {
  if (node.range && node.range.length === 2) {
    return { start: node.range[0], end: node.range[1] };
  }
  if (typeof node.start === "number" && typeof node.end === "number") {
    return { start: node.start, end: node.end };
  }
  return undefined;
}

/** ESTree adapter used by the build transform (oxc-parser) and the fallback (meriyah). */
export const adapterOxc: AstAdapter = { name: "oxc", span: spanOf };

/** ESTree adapter used by the language service and ESLint (`@typescript-eslint` TSESTree). */
export const adapterTsestree: AstAdapter = { name: "tsestree", span: spanOf };
