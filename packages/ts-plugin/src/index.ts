/**
 * `@treequel/ts-plugin` — a TypeScript language-service plugin that surfaces the
 * subset diagnostics in-editor (red squiggles), using the *same* capture
 * validator as the build and ESLint via {@link diagnoseLambdaSource}.
 *
 * Configure in tsconfig.json:
 *   { "compilerOptions": { "plugins": [{ "name": "@treequel/ts-plugin" }] } }
 */
import type ts from "typescript";
import { diagnoseLambdaSource } from "./diagnose.js";
import { LINQ_METHODS } from "./methods.js";

export { diagnoseLambdaSource } from "./diagnose.js";
export type { LambdaDiagnostic } from "./diagnose.js";

function isQueryLambda(tsm: typeof ts, arrow: ts.ArrowFunction): boolean {
  const call = arrow.parent;
  if (!call || !tsm.isCallExpression(call)) return false;
  if (!call.arguments.includes(arrow)) return false;
  const callee = call.expression;
  if (tsm.isIdentifier(callee) && callee.text === "expr") return true;
  if (tsm.isPropertyAccessExpression(callee)) return LINQ_METHODS.has(callee.name.text);
  return false;
}

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const tsm = modules.typescript;

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      const ls = info.languageService;
      const proxy = Object.create(null) as ts.LanguageService;
      const proxyRecord = proxy as unknown as Record<string, unknown>;
      for (const key of Object.keys(ls) as Array<keyof ts.LanguageService>) {
        const member = ls[key];
        proxyRecord[key as string] =
          typeof member === "function" ? (member as (...a: unknown[]) => unknown).bind(ls) : member;
      }

      proxy.getSemanticDiagnostics = (fileName: string): ts.Diagnostic[] => {
        const prior = ls.getSemanticDiagnostics(fileName);
        const sourceFile = ls.getProgram()?.getSourceFile(fileName);
        if (!sourceFile) return prior;

        const extra: ts.Diagnostic[] = [];
        const visit = (node: ts.Node): void => {
          if (tsm.isArrowFunction(node) && isQueryLambda(tsm, node)) {
            const text = node.getText(sourceFile);
            const base = node.getStart(sourceFile);
            for (const d of diagnoseLambdaSource(text)) {
              extra.push({
                file: sourceFile,
                start: base + d.start,
                length: d.length,
                messageText: d.message,
                category:
                  d.severity === "error"
                    ? tsm.DiagnosticCategory.Error
                    : d.severity === "warn"
                      ? tsm.DiagnosticCategory.Warning
                      : tsm.DiagnosticCategory.Suggestion,
                code: d.code,
                source: "treequel",
              });
            }
          }
          tsm.forEachChild(node, visit);
        };
        visit(sourceFile);
        return [...prior, ...extra];
      };

      return proxy;
    },
  };
}

export default init;
