/**
 * `@treequel/ts-transformer` — reify Treequel query lambdas when the build runs
 * through the TypeScript compiler instead of a bundler. It is a thin host over
 * `@treequel/transform`: the oxc-based tracer/capture decides what to reify, and
 * this package applies those edits to the TypeScript AST. The one parser stays
 * oxc; TypeScript only drives emit.
 *
 * The stock `tsc` CLI runs no custom emit transformers, so reach it one of two ways:
 *
 * 1. **ts-patch** (`plugins` in tsconfig, then `tsc`/`tsc -b`):
 *    ```json
 *    { "compilerOptions": { "plugins": [{ "transform": "@treequel/ts-transformer" }] } }
 *    ```
 * 2. **The compiler API** — pass {@link createTransformerFactory} to `program.emit`:
 *    ```ts
 *    program.emit(undefined, undefined, undefined, false, {
 *      before: [createTransformerFactory(program)],
 *    });
 *    ```
 *
 * Transformers run during emit only: `.d.ts` output is unaffected, and an emitter
 * that skips the TypeScript program (esbuild, swc, Babel) skips this too. The
 * injected host import is a live ES-module binding, so the compiler must emit ES
 * modules (`module: esnext`/`nodenext`) — Treequel is ESM-only regardless.
 */
import ts from "typescript";
import {
  type ContextRegistry,
  type ReifyPlan,
  type SyncTransformHost,
  type TransformOptions,
  HOST_IMPORT,
  createRegistry,
  planModuleSync,
  scanModuleContexts,
} from "@treequel/transform";

export type FilterPattern = RegExp | RegExp[];

export interface TreequelTransformerOptions {
  /** Traced import sources. Default: `["@treequel/query"]`. */
  packages?: readonly string[];
  /** Extra globals safelist passed through to capture. */
  globals?: readonly string[];
  /** Emit the original source text as `src`. Default: `false`. */
  emitSource?: boolean;
  /** Files to process. Default: `/\.[cm]?[jt]sx?$/`. */
  include?: FilterPattern;
  /** Files to skip. Default: `/node_modules/`. */
  exclude?: FilterPattern;
  /**
   * How to surface subset diagnostics: `"error"` throws and fails the build,
   * `"warn"` prints to the console, `"silent"` does neither. Default: `"warn"`.
   */
  diagnostics?: "error" | "warn" | "silent";
}

/** `NodeFlags.Synthesized` — not in the public `.d.ts`, but a stable bit. */
const SYNTHESIZED = 16;

const DEFAULT_INCLUDE = /\.[cm]?[jt]sx?$/;
const DEFAULT_EXCLUDE = /node_modules/;

function matches(patterns: FilterPattern, id: string): boolean {
  return Array.isArray(patterns) ? patterns.some((p) => p.test(id)) : patterns.test(id);
}

/** Accept a caller-supplied filter only when it is a RegExp (never a JSON string). */
function asFilter(value: unknown, fallback: FilterPattern): FilterPattern {
  if (value instanceof RegExp) return value;
  if (Array.isArray(value) && value.every((p) => p instanceof RegExp)) return value as RegExp[];
  return fallback;
}

/** Resolve a specifier to a source file through the program's own module resolution. */
function resolveModule(program: ts.Program, source: string, importer: string): string | null {
  const host: ts.ModuleResolutionHost = {
    fileExists: (f) => program.getSourceFile(f) !== undefined || ts.sys.fileExists(f),
    readFile: (f) => program.getSourceFile(f)?.text ?? ts.sys.readFile(f),
  };
  const resolved = ts.resolveModuleName(source, importer, program.getCompilerOptions(), host);
  return resolved.resolvedModule?.resolvedFileName ?? null;
}

function reportDiagnostics(
  diagnostics: ReifyPlan["diagnostics"],
  fileName: string,
  mode: "error" | "warn" | "silent",
): void {
  if (mode === "silent") return;
  for (const d of diagnostics) {
    const line = `[treequel] ${d.code} ${d.message}${d.hint ? ` — ${d.hint}` : ""} (${fileName})`;
    if (d.severity === "error" && mode === "error") throw new Error(line);
    console.warn(line);
  }
}

/**
 * Turn a parse subtree into a fully synthesized one: the emitter then prints it
 * from structure (positions cleared) and the emit resolver skips it as a
 * non-parse-tree node (the Synthesized bit), so it never looks up the symbols
 * our throwaway parse never bound.
 */
function synthesize(node: ts.Node): void {
  ts.setTextRange(node, { pos: -1, end: -1 });
  (node as { flags: number }).flags |= SYNTHESIZED;
  ts.forEachChild(node, (child) => {
    synthesize(child);
  });
}

/** Parse an `__expr({...})` replacement string into a synthesized expression node. */
function parseReplacement(text: string, target: ts.ScriptTarget): ts.Expression {
  const sf = ts.createSourceFile(
    "__treequel_expr__.ts",
    `(${text})`,
    target,
    false,
    ts.ScriptKind.TS,
  );
  const paren = (sf.statements[0] as ts.ExpressionStatement)
    .expression as ts.ParenthesizedExpression;
  synthesize(paren.expression);
  return paren.expression;
}

/**
 * Whether this file emits CommonJS. The injected host import is a live ES-module
 * binding; under `require()` output the reference would be left unbound, so the
 * transformer refuses rather than emit broken code.
 */
function emitsCommonJs(program: ts.Program | undefined, sourceFile: ts.SourceFile): boolean {
  const opts = program?.getCompilerOptions();
  if (!opts) return false; // no program (e.g. ts.transform) → assume ES modules
  const target = opts.target ?? ts.ScriptTarget.ES2015;
  const moduleKind =
    opts.module ??
    (target >= ts.ScriptTarget.ES2015 ? ts.ModuleKind.ES2015 : ts.ModuleKind.CommonJS);
  if (moduleKind >= ts.ModuleKind.Node16) {
    return sourceFile.impliedNodeFormat === ts.ModuleKind.CommonJS;
  }
  return moduleKind < ts.ModuleKind.ES2015; // CommonJS / AMD / UMD / System
}

/** The `import { __expr as __tql_expr$ } from "@treequel/core"` the host references. */
function hostImport(): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(
          false,
          ts.factory.createIdentifier(HOST_IMPORT.imported),
          ts.factory.createIdentifier(HOST_IMPORT.local),
        ),
      ]),
    ),
    ts.factory.createStringLiteral(HOST_IMPORT.source),
  );
}

/**
 * Build a `before` transformer factory that reifies query lambdas during emit.
 * Pass the `program` so cross-module contexts (a `db` imported from another file)
 * resolve: every project source is pre-scanned up front, since a transformer runs
 * synchronously and cannot load modules on demand. Without a program, only
 * `expr()` wrappers and same-module contexts reify.
 */
export function createTransformerFactory(
  program?: ts.Program,
  options: TreequelTransformerOptions = {},
): ts.TransformerFactory<ts.SourceFile> {
  const include = asFilter(options.include, DEFAULT_INCLUDE);
  const exclude = asFilter(options.exclude, DEFAULT_EXCLUDE);
  const packages = options.packages ? [...options.packages] : undefined;
  const mode = options.diagnostics ?? "warn";
  const registry: ContextRegistry = createRegistry();

  const included = (fileName: string): boolean =>
    !matches(exclude, fileName) && matches(include, fileName);

  const scanOptions: TransformOptions = packages ? { packages } : {};

  // Pre-scan every project source so cross-module contexts resolve without an
  // async on-demand load — the compiler hands us the whole program at once.
  if (program) {
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile || !included(sf.fileName)) continue;
      const names = scanModuleContexts(sf.text, sf.fileName, scanOptions);
      if (names.length > 0) registry.contexts.set(sf.fileName, new Set(names));
    }
  }

  const host: SyncTransformHost | undefined = program
    ? { resolve: (source, importer) => resolveModule(program, source, importer) }
    : undefined;

  const transformOptions: TransformOptions = {
    ...(packages ? { packages } : {}),
    ...(options.globals ? { globals: [...options.globals] } : {}),
    emitSource: options.emitSource ?? false,
    registry,
  };

  return (context) => (sourceFile) => {
    if (sourceFile.isDeclarationFile || !included(sourceFile.fileName)) return sourceFile;

    const plan = planModuleSync(sourceFile.text, sourceFile.fileName, transformOptions, host);
    if (!plan) return sourceFile;

    reportDiagnostics(plan.diagnostics, sourceFile.fileName, mode);
    if (plan.count === 0) return sourceFile;

    if (emitsCommonJs(program, sourceFile)) {
      throw new Error(
        `[treequel] the TypeScript transformer needs ES module output — set "module" to ` +
          `"esnext" or "nodenext". CommonJS emit leaves the reified host import unbound ` +
          `(${sourceFile.fileName}).`,
      );
    }

    const target = sourceFile.languageVersion;
    const bySpan = new Map<string, string>();
    for (const e of plan.edits) bySpan.set(`${e.start}:${e.end}`, e.replacement);

    // Replace each detected node (arrow, or `expr(...)` wrapper) by its span.
    const visit: ts.Visitor = (node) => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isCallExpression(node)) {
        const replacement = bySpan.get(`${node.getStart(sourceFile)}:${node.getEnd()}`);
        if (replacement !== undefined) return parseReplacement(replacement, target);
      }
      return ts.visitEachChild(node, visit, context);
    };
    const visited = ts.visitEachChild(sourceFile, visit, context);

    return ts.factory.updateSourceFile(visited, [hostImport(), ...visited.statements]);
  };
}

/**
 * ts-patch program-transformer entry. ts-patch calls this with the `Program` and
 * the plugin config (which carries any {@link TreequelTransformerOptions}); the
 * default export is what `{ "transform": "@treequel/ts-transformer" }` loads.
 */
export default function treequelTransformer(
  program: ts.Program,
  config: TreequelTransformerOptions = {},
): ts.TransformerFactory<ts.SourceFile> {
  return createTransformerFactory(program, config);
}
