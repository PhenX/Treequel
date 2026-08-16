import { type Diagnostic, adapterOxc, capture } from "@treequel/capture";
import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import { emitNode, offsetToLineCol } from "./emit.js";

/** LINQ methods whose lambda-literal arguments are expression positions. */
const LINQ_METHODS = new Set([
  "where",
  "select",
  "orderBy",
  "orderByDescending",
  "thenBy",
  "thenByDescending",
  "groupBy",
  "count",
  "some",
  "every",
  "first",
  "firstOrThrow",
  "single",
  "sum",
  "min",
  "max",
  "avg",
  "join",
  "leftJoin",
  "flatMap",
]);

const HOST_ALIAS = "__tql_expr$";

/** The module specifier and named binding a reified module imports the host from. */
export const HOST_IMPORT: {
  readonly source: string;
  readonly imported: string;
  readonly local: string;
} = { source: "@treequel/core", imported: "__expr", local: HOST_ALIAS };

export interface TransformOptions {
  /** Traced import sources. Default: `["@treequel/linq"]`. */
  readonly packages?: readonly string[];
  /** Extra globals safelist passed through to capture. */
  readonly globals?: readonly string[];
  /** Emit the original source text as `src` (dev debugging). Default: true. */
  readonly emitSource?: boolean;
  /** Cross-module context registry (shared across a build). */
  readonly registry?: ContextRegistry;
}

/**
 * Async host: a bundler that can resolve a specifier and ask for another module
 * to be transformed on demand, so the context registry fills in lazily.
 */
export interface TransformHost {
  resolve(id: string, importer: string): Promise<string | null> | string | null;
  /** Ask the bundler to transform/scan a module so the registry is populated. */
  load(id: string): Promise<void> | void;
}

/**
 * Synchronous host: resolves a specifier to a module id. There is no `load` —
 * the registry must already be populated (a whole-program pre-scan). Used by
 * hosts that run the transform synchronously, such as a TypeScript-compiler
 * transformer.
 */
export interface SyncTransformHost {
  resolve(id: string, importer: string): string | null;
}

export interface ContextRegistry {
  /** moduleId → set of exported names that are query contexts. */
  readonly contexts: Map<string, Set<string>>;
}

export function createRegistry(): ContextRegistry {
  return { contexts: new Map() };
}

export interface TransformResult {
  readonly code: string;
  readonly map: ReturnType<MagicString["generateMap"]>;
  readonly diagnostics: readonly Diagnostic[];
  /** Number of lambdas reified (for tests / stats). */
  readonly count: number;
}

/**
 * A single source replacement in the original module's coordinates: the span of
 * the node to replace (`expr(...)` wrapper or bare arrow) and the `__expr({...})`
 * text that stands in for it. AST-level hosts apply these directly; text-level
 * hosts get the spliced string from {@link transformModule}.
 */
export interface ReifyEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export interface ReifyPlan {
  readonly edits: readonly ReifyEdit[];
  readonly diagnostics: readonly Diagnostic[];
  /** Number of lambdas reified. When `> 0`, the host also imports {@link HOST_IMPORT}. */
  readonly count: number;
}

interface AnyNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

function langOf(id: string): "ts" | "tsx" | "js" | "jsx" {
  const clean = id.replace(/\?.*$/, "");
  if (clean.endsWith(".tsx")) return "tsx";
  if (clean.endsWith(".jsx")) return "jsx";
  if (/\.(m|c)?ts$/.test(clean)) return "ts";
  return "js";
}

function walk(node: unknown, enter: (n: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, enter);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type === "string") enter(n as unknown as AnyNode);
  for (const key in n) {
    if (key === "type" || key === "parent") continue;
    const v = n[key];
    if (v && typeof v === "object") walk(v, enter);
  }
}

function unwrap(n: AnyNode): AnyNode {
  let cur = n;
  while (
    cur.type === "ParenthesizedExpression" ||
    cur.type === "TSAsExpression" ||
    cur.type === "TSSatisfiesExpression" ||
    cur.type === "TSNonNullExpression" ||
    cur.type === "TSTypeAssertion" ||
    cur.type === "ChainExpression"
  ) {
    cur = cur.expression as AnyNode;
  }
  return cur;
}

/** A `createContext()` call: a bare traced import, or `r.createContext()` on a namespace import. */
function makeIsCreateContextCall(
  createLocals: ReadonlySet<string>,
  namespaceLocals: ReadonlySet<string>,
): (n: AnyNode) => boolean {
  return function isCreateContextCall(n: AnyNode): boolean {
    if (n.type !== "CallExpression") return false;
    const callee = n.callee as AnyNode;
    if (callee.type === "Identifier") return createLocals.has(callee.name as string);
    if (callee.type === "MemberExpression") {
      const obj = callee.object as AnyNode;
      const prop = callee.property as AnyNode;
      return (
        obj.type === "Identifier" &&
        namespaceLocals.has(obj.name as string) &&
        prop.type === "Identifier" &&
        prop.name === "createContext"
      );
    }
    return false;
  };
}

/** Names bound to a `createContext()` result at a module's top level. */
function collectModuleContexts(
  program: { body: AnyNode[] },
  isCreateContextCall: (n: AnyNode) => boolean,
): Set<string> {
  const names = new Set<string>();
  for (const stmt of program.body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" ? (stmt.declaration as AnyNode | null) : null;
    const varDecl =
      decl?.type === "VariableDeclaration"
        ? decl
        : stmt.type === "VariableDeclaration"
          ? stmt
          : null;
    if (!varDecl) continue;
    for (const d of (varDecl.declarations as AnyNode[]) ?? []) {
      if (
        (d.id as AnyNode)?.type === "Identifier" &&
        d.init &&
        isCreateContextCall(d.init as AnyNode)
      ) {
        names.add((d.id as { name: string }).name);
      }
    }
  }
  return names;
}

/** The parse + import-collection stage, shared by every entry point. */
interface Analysis {
  readonly program: { body: AnyNode[] };
  readonly exprLocals: ReadonlySet<string>;
  readonly namespaceLocals: ReadonlySet<string>;
  readonly importedBindings: ReadonlyMap<string, { source: string; imported: string }>;
  readonly isCreateContextCall: (n: AnyNode) => boolean;
}

/**
 * Cheap pre-scan, parse and import collection. Returns `null` when the module
 * cannot contain a reification target (no traced package and no `expr(`), or
 * when it fails to parse.
 */
function analyze(code: string, id: string, packages: readonly string[]): Analysis | null {
  // Cheap pre-scan: bail unless the module references a traced package or expr(.
  if (!packages.some((p) => code.includes(p)) && !/\bexpr\s*\(/.test(code)) {
    return null;
  }

  const parsed = parseSync(id, code, { lang: langOf(id) });
  if (parsed.errors.length > 0) return null;
  const program = parsed.program as unknown as { body: AnyNode[] };

  const createLocals = new Set<string>();
  const exprLocals = new Set<string>();
  const namespaceLocals = new Set<string>();
  const importedBindings = new Map<string, { source: string; imported: string }>();

  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = (stmt.source as { value: string }).value;
    const traced = packages.includes(source);
    for (const spec of (stmt.specifiers as AnyNode[]) ?? []) {
      const local = (spec.local as { name: string }).name;
      if (spec.type === "ImportNamespaceSpecifier") {
        if (traced) namespaceLocals.add(local);
      } else if (spec.type === "ImportSpecifier") {
        const imported = (spec.imported as { name: string }).name;
        if (traced) {
          if (imported === "createContext") createLocals.add(local);
          else if (imported === "expr") exprLocals.add(local);
        } else {
          importedBindings.set(local, { source, imported });
        }
      }
    }
  }

  return {
    program,
    exprLocals,
    namespaceLocals,
    importedBindings,
    isCreateContextCall: makeIsCreateContextCall(createLocals, namespaceLocals),
  };
}

/** Register this module's own exported contexts so other modules can find them. */
function registerContexts(registry: ContextRegistry, id: string, analysis: Analysis): void {
  const names = collectModuleContexts(analysis.program, analysis.isCreateContextCall);
  if (names.size === 0) return;
  const existing = registry.contexts.get(id) ?? new Set<string>();
  for (const nm of names) existing.add(nm);
  registry.contexts.set(id, existing);
}

/** Synchronously resolve which imported bindings name a cross-module context. */
function resolveCrossLocalsSync(
  analysis: Analysis,
  registry: ContextRegistry,
  host: SyncTransformHost,
  id: string,
): Set<string> {
  const crossLocals = new Set<string>();
  for (const [local, { source, imported }] of analysis.importedBindings) {
    if (!source.startsWith(".") && !source.startsWith("/")) continue;
    const resolved = host.resolve(source, id);
    if (!resolved) continue;
    if (registry.contexts.get(resolved)?.has(imported)) crossLocals.add(local);
  }
  return crossLocals;
}

/** A reification target: a bare arrow, or an arrow wrapped in an `expr(...)` call. */
interface Target {
  readonly arrow: AnyNode;
  readonly exprCall?: AnyNode;
}

/**
 * Intra-module taint plus expression-position detection. `crossLocals` names the
 * bindings a host resolved to a cross-module context; they taint after the
 * intra-module fixpoint. Returns the outermost targets, source-ordered.
 */
function detectTargets(analysis: Analysis, crossLocals: ReadonlySet<string>): Target[] {
  const { program, exprLocals, namespaceLocals, isCreateContextCall } = analysis;

  // --- taint (intra-module) ----------------------------------------------
  const taint = new Set<string>();
  const declarators: Array<{ name: string; init: AnyNode }> = [];
  walk(program, (n) => {
    if (n.type === "VariableDeclarator" && (n.id as AnyNode)?.type === "Identifier" && n.init) {
      declarators.push({ name: (n.id as { name: string }).name, init: n.init as AnyNode });
    }
  });

  const isTainted = (node: AnyNode): boolean => {
    const n = unwrap(node);
    switch (n.type) {
      case "Identifier":
        return taint.has(n.name as string);
      case "MemberExpression":
        return isTainted(n.object as AnyNode);
      case "CallExpression":
        return isCreateContextCall(n) || isTainted(n.callee as AnyNode);
      case "ConditionalExpression":
        return isTainted(n.consequent as AnyNode) && isTainted(n.alternate as AnyNode);
      default:
        return false;
    }
  };

  // Fixpoint so `const a = db.users; const q = a.where(...)` both taint.
  for (let changed = true; changed;) {
    changed = false;
    for (const d of declarators) {
      if (!taint.has(d.name) && isTainted(d.init)) {
        taint.add(d.name);
        changed = true;
      }
    }
  }

  // A binding a host resolved to a cross-module context taints directly.
  for (const local of crossLocals) taint.add(local);

  // --- detect expression positions ---------------------------------------
  // `exprCall` set → the whole `expr(...)` wrapper is replaced by the host;
  // otherwise the arrow is wrapped in place as a query-method argument.
  const targets: Target[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = n.callee as AnyNode;
    const args = (n.arguments as AnyNode[]) ?? [];

    // expr(fn) — always reified.
    const isExprCall =
      (callee.type === "Identifier" && exprLocals.has(callee.name as string)) ||
      (callee.type === "MemberExpression" &&
        (callee.object as AnyNode).type === "Identifier" &&
        namespaceLocals.has(((callee.object as AnyNode).name as string) ?? "") &&
        (callee.property as AnyNode).type === "Identifier" &&
        (callee.property as AnyNode).name === "expr");

    if (isExprCall) {
      const first = args[0];
      if (
        first &&
        (first.type === "ArrowFunctionExpression" || first.type === "FunctionExpression")
      ) {
        targets.push({ arrow: first, exprCall: n });
      }
      return;
    }

    // include()/thenInclude() refine callbacks: the builder parameter acts as
    // a traced receiver inside the callback, so `q.where(o => …)` reifies.
    if (
      callee.type === "MemberExpression" &&
      (callee.property as AnyNode).type === "Identifier" &&
      ((callee.property as AnyNode).name === "include" ||
        (callee.property as AnyNode).name === "thenInclude") &&
      isTainted(callee.object as AnyNode)
    ) {
      const refine = args[1];
      const param = (refine?.params as AnyNode[] | undefined)?.[0];
      if (
        refine?.type === "ArrowFunctionExpression" &&
        param?.type === "Identifier" &&
        typeof param.name === "string"
      ) {
        const builder = param.name as string;
        const rootsAtBuilder = (m: AnyNode): boolean => {
          const u = unwrap(m);
          if (u.type === "Identifier") return u.name === builder;
          if (u.type === "MemberExpression") return rootsAtBuilder(u.object as AnyNode);
          if (u.type === "CallExpression") return rootsAtBuilder(u.callee as AnyNode);
          return false;
        };
        walk(refine.body, (m) => {
          if (m.type !== "CallExpression") return;
          const mc = m.callee as AnyNode;
          if (
            mc.type === "MemberExpression" &&
            (mc.property as AnyNode).type === "Identifier" &&
            LINQ_METHODS.has((mc.property as AnyNode).name as string) &&
            rootsAtBuilder(mc.object as AnyNode)
          ) {
            for (const a of (m.arguments as AnyNode[]) ?? []) {
              if (a.type === "ArrowFunctionExpression") targets.push({ arrow: a });
            }
          }
        });
      }
      return;
    }

    // tainted LINQ method call — reify arrow arguments.
    if (
      callee.type === "MemberExpression" &&
      (callee.property as AnyNode).type === "Identifier" &&
      LINQ_METHODS.has((callee.property as AnyNode).name as string) &&
      isTainted(callee.object as AnyNode)
    ) {
      for (const arg of args) {
        if (arg.type === "ArrowFunctionExpression") targets.push({ arrow: arg });
      }
    }
  });

  // Keep only outermost arrows (drop any nested inside another target).
  const outer = targets.filter(
    (t) =>
      !targets.some(
        (o) => o.arrow !== t.arrow && o.arrow.start <= t.arrow.start && o.arrow.end >= t.arrow.end,
      ),
  );
  outer.sort((a, b) => a.arrow.start - b.arrow.start);
  return outer;
}

/** The `__expr({...})` prefix/suffix around a lambda, or `null` if it left the subset. */
interface Capture {
  readonly prefix: string;
  readonly suffix: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
}

function captureArrow(
  code: string,
  id: string,
  options: TransformOptions,
  arrow: AnyNode,
): Capture {
  const result = capture(arrow as never, adapterOxc, { globals: options.globals });
  if (result.body === null) {
    return { prefix: "", suffix: "", diagnostics: result.diagnostics, ok: false };
  }
  const emitSource = options.emitSource ?? true;
  const scopeObj = result.freeVars.length > 0 ? `{${result.freeVars.join(",")}}` : "{}";
  const { line, col } = offsetToLineCol(code, arrow.start);
  const loc = `${id}:${line}:${col}`;
  const srcText = code.slice(arrow.start, arrow.end);

  const prefix = `${HOST_ALIAS}({v:1,compiled:`;
  const suffix =
    `,params:${JSON.stringify(result.params)}` +
    `,body:${emitNode(result.body)}` +
    `,scope:()=>(${scopeObj})` +
    (emitSource ? `,src:${JSON.stringify(srcText)}` : "") +
    `,loc:${JSON.stringify(loc)}})`;
  return { prefix, suffix, diagnostics: result.diagnostics, ok: true };
}

/** Text output: splice `__expr({...})` in with magic-string, preserving source spans. */
function reify(
  code: string,
  id: string,
  options: TransformOptions,
  analysis: Analysis,
  crossLocals: ReadonlySet<string>,
): TransformResult | null {
  const outer = detectTargets(analysis, crossLocals);
  if (outer.length === 0) return null;

  const s = new MagicString(code);
  const diagnostics: Diagnostic[] = [];
  let count = 0;

  for (const { arrow, exprCall } of outer) {
    const cap = captureArrow(code, id, options, arrow);
    diagnostics.push(...cap.diagnostics);
    if (!cap.ok) continue; // errors — leave the lambda untouched

    if (exprCall) {
      // Replace the whole `expr( … )` wrapper, keeping the arrow as `compiled`.
      s.overwrite(exprCall.start, arrow.start, cap.prefix);
      s.overwrite(arrow.end, exprCall.end, cap.suffix);
    } else {
      // Wrap the arrow in place as a query-method argument.
      s.appendLeft(arrow.start, cap.prefix);
      s.appendRight(arrow.end, cap.suffix);
    }
    count++;
  }

  if (count === 0) {
    return { code, map: s.generateMap({ hires: true }), diagnostics, count: 0 };
  }

  s.prepend(
    `import { ${HOST_IMPORT.imported} as ${HOST_IMPORT.local} } from "${HOST_IMPORT.source}";\n`,
  );

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: id, includeContent: true }),
    diagnostics,
    count,
  };
}

/** Edit-list output: the same reification expressed as node-span replacements. */
function planReify(
  code: string,
  id: string,
  options: TransformOptions,
  analysis: Analysis,
  crossLocals: ReadonlySet<string>,
): ReifyPlan | null {
  const outer = detectTargets(analysis, crossLocals);
  if (outer.length === 0) return null;

  const edits: ReifyEdit[] = [];
  const diagnostics: Diagnostic[] = [];
  let count = 0;

  for (const { arrow, exprCall } of outer) {
    const cap = captureArrow(code, id, options, arrow);
    diagnostics.push(...cap.diagnostics);
    if (!cap.ok) continue;

    const start = exprCall ? exprCall.start : arrow.start;
    const end = exprCall ? exprCall.end : arrow.end;
    edits.push({
      start,
      end,
      replacement: cap.prefix + code.slice(arrow.start, arrow.end) + cap.suffix,
    });
    count++;
  }

  return { edits, diagnostics, count };
}

/**
 * The pure per-module transform: reify lambda literals written at traced query
 * call sites (or wrapped in `expr()`) into `__expr({...})`. Bundler-free — any
 * host can drive it. Returns `null` when the module needs no change.
 */
export async function transformModule(
  code: string,
  id: string,
  options: TransformOptions = {},
  host?: TransformHost,
): Promise<TransformResult | null> {
  const packages = options.packages ?? ["@treequel/linq"];
  const analysis = analyze(code, id, packages);
  if (!analysis) return null;

  // Register this module's own exported contexts for other modules to find.
  if (options.registry) registerContexts(options.registry, id, analysis);

  // Cross-module context resolution (best effort): chase relative imports whose
  // resolved module exports a context, loading it on demand to fill the registry.
  const crossLocals = new Set<string>();
  if (host && options.registry && analysis.importedBindings.size > 0) {
    for (const [local, { source, imported }] of analysis.importedBindings) {
      // Only chase relative imports — a context lives in a project module, never a package.
      if (!source.startsWith(".") && !source.startsWith("/")) continue;
      const resolved = await host.resolve(source, id);
      if (!resolved) continue;
      let names = options.registry.contexts.get(resolved);
      if (!names) {
        await host.load(resolved);
        names = options.registry.contexts.get(resolved);
      }
      if (names?.has(imported)) crossLocals.add(local);
    }
  }

  return reify(code, id, options, analysis, crossLocals);
}

/**
 * Synchronous sibling of {@link transformModule} for hosts that cannot await —
 * a TypeScript-compiler transformer runs during emit, which is synchronous.
 * Cross-module contexts are resolved through a synchronous {@link SyncTransformHost}
 * against an already-populated registry (there is no on-demand `load`); pre-scan
 * the whole program with {@link scanModuleContexts} to fill it first.
 */
export function transformModuleSync(
  code: string,
  id: string,
  options: TransformOptions = {},
  host?: SyncTransformHost,
): TransformResult | null {
  const packages = options.packages ?? ["@treequel/linq"];
  const analysis = analyze(code, id, packages);
  if (!analysis) return null;

  if (options.registry) registerContexts(options.registry, id, analysis);

  const crossLocals =
    host && options.registry && analysis.importedBindings.size > 0
      ? resolveCrossLocalsSync(analysis, options.registry, host, id)
      : new Set<string>();

  return reify(code, id, options, analysis, crossLocals);
}

/**
 * Reification as a list of node-span replacements in the original module's
 * coordinates, for hosts that edit an AST rather than text (a TypeScript-compiler
 * transformer replaces the matched nodes and imports {@link HOST_IMPORT}). Same
 * detection and capture as {@link transformModuleSync}; returns `null` when the
 * module needs no change.
 */
export function planModuleSync(
  code: string,
  id: string,
  options: TransformOptions = {},
  host?: SyncTransformHost,
): ReifyPlan | null {
  const packages = options.packages ?? ["@treequel/linq"];
  const analysis = analyze(code, id, packages);
  if (!analysis) return null;

  if (options.registry) registerContexts(options.registry, id, analysis);

  const crossLocals =
    host && options.registry && analysis.importedBindings.size > 0
      ? resolveCrossLocalsSync(analysis, options.registry, host, id)
      : new Set<string>();

  return planReify(code, id, options, analysis, crossLocals);
}

/**
 * Names bound to a `createContext()` result at a module's top level, without
 * transforming it. A synchronous host pre-scans every module with this to build
 * the cross-module context registry before it starts transforming.
 */
export function scanModuleContexts(
  code: string,
  id: string,
  options: TransformOptions = {},
): readonly string[] {
  const packages = options.packages ?? ["@treequel/linq"];
  const analysis = analyze(code, id, packages);
  if (!analysis) return [];
  return [...collectModuleContexts(analysis.program, analysis.isCreateContextCall)];
}
