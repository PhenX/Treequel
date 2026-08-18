import * as monaco from "monaco-editor/editor/editor.api";

/**
 * Turning Greffon's diagnostics into Monaco squiggles is the whole point of the
 * error surface, so the offsets have to line up exactly. The fallback parser
 * wraps the lambda as `(${source.trim()})` before parsing, so every span and
 * every parser offset is measured against that wrapped string — one code unit of
 * leading `(`, plus whatever whitespace `trim()` removed from the front.
 */

/** A capture diagnostic, structurally — the playground doesn't import capture. */
export interface SpanDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly hint?: string;
  readonly span?: { readonly start: number; readonly end: number };
}

const OWNER = "greffon";

function severityFor(severity: string): monaco.MarkerSeverity {
  if (severity === "warn") return monaco.MarkerSeverity.Warning;
  if (severity === "info") return monaco.MarkerSeverity.Info;
  return monaco.MarkerSeverity.Error;
}

function codeLink(code: string): { value: string; target: monaco.Uri } {
  return { value: code, target: monaco.Uri.parse(`https://greffon.dev/errors#${code}`) };
}

/** Map an offset in the wrapped `(…)` source back to one in the editor's text. */
function offsetMapper(source: string): (offset: number) => number {
  const leading = source.length - source.trimStart().length;
  const len = source.length;
  return (offset) => {
    const mapped = offset - 1 + leading;
    return mapped < 0 ? 0 : mapped > len ? len : mapped;
  };
}

/** A range covering at least one character, so Monaco always draws a squiggle. */
function rangeFromOffsets(
  model: monaco.editor.ITextModel,
  startOffset: number,
  endOffset: number,
): monaco.IRange {
  const from = model.getPositionAt(startOffset);
  const to = model.getPositionAt(Math.max(endOffset, startOffset + 1));
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  };
}

/** Markers for subset diagnostics; a diagnostic without a span covers the whole lambda. */
export function diagnosticMarkers(
  model: monaco.editor.ITextModel,
  source: string,
  diagnostics: readonly SpanDiagnostic[],
): monaco.editor.IMarkerData[] {
  const map = offsetMapper(source);
  const tail = model.getPositionAt(model.getValueLength());
  return diagnostics.map((d) => {
    const range = d.span
      ? rangeFromOffsets(model, map(d.span.start), map(d.span.end))
      : {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: tail.lineNumber,
          endColumn: tail.column,
        };
    return {
      severity: severityFor(d.severity),
      message: d.hint ? `${d.message}\n\n${d.hint}` : d.message,
      source: OWNER,
      code: codeLink(d.code),
      ...range,
    };
  });
}

export interface ParseErrorInfo {
  readonly message: string;
  readonly start?: number;
  readonly end?: number;
}

/** Read the offsets and description off a meriyah `ParseError` (or any thrown error). */
export function parseErrorInfo(err: unknown): ParseErrorInfo {
  const e = err as { start?: unknown; end?: unknown; description?: unknown; message?: unknown };
  const detail =
    (typeof e.description === "string" && e.description) ||
    (typeof e.message === "string" && e.message) ||
    String(err);
  return {
    message: `Syntax error: ${detail}`,
    start: typeof e.start === "number" ? e.start : undefined,
    end: typeof e.end === "number" ? e.end : undefined,
  };
}

/** A single marker at the parser's reported location, or the whole lambda if it gave none. */
export function parseErrorMarkers(
  model: monaco.editor.ITextModel,
  source: string,
  info: ParseErrorInfo,
): monaco.editor.IMarkerData[] {
  const map = offsetMapper(source);
  const len = model.getValueLength();
  const startOffset = info.start === undefined ? 0 : map(info.start);
  const endOffset = info.end === undefined ? len : map(info.end);
  return [
    {
      severity: monaco.MarkerSeverity.Error,
      message: info.message,
      source: OWNER,
      code: codeLink("R1100"),
      ...rangeFromOffsets(model, startOffset, endOffset),
    },
  ];
}

export function setMarkers(
  model: monaco.editor.ITextModel,
  markers: monaco.editor.IMarkerData[],
): void {
  monaco.editor.setModelMarkers(model, OWNER, markers);
}
