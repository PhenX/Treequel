/**
 * `@treequel/ts-plugin` — a TypeScript language-service plugin that surfaces the
 * subset diagnostics in-editor (red squiggles), using the *same* capture
 * validator as the build and ESLint via {@link diagnoseLambdaSource}.
 *
 * Configure in tsconfig.json:
 *   { "compilerOptions": { "plugins": [{ "name": "@treequel/ts-plugin" }] } }
 */
import { QUERY_METHODS } from "@treequel/capture";
import type ts from "typescript";
import { diagnoseLambdaSource } from "./diagnose.js";

export { diagnoseLambdaSource } from "./diagnose.js";
export type { LambdaDiagnostic } from "./diagnose.js";

/**
 * A receiver carrying the fluent query surface — `Queryable`/`Ordered`/
 * `Includable`/`IncludeQuery` all expose `orderBy`, which `Array` does not. This
 * is what tells `db.users.filter(…)` apart from an ordinary `rows.filter(…)`
 * now that the operators are named after their `Array` equivalents. Type-based,
 * so it resolves the receiver even when the context is imported from elsewhere.
 */
function isQueryReceiver(checker: ts.TypeChecker, receiver: ts.Expression): boolean {
  const type = checker.getApparentType(checker.getTypeAtLocation(receiver));
  return (
    checker.getPropertyOfType(type, "orderBy") !== undefined &&
    checker.getPropertyOfType(type, "filter") !== undefined
  );
}

function isQueryLambda(tsm: typeof ts, checker: ts.TypeChecker, arrow: ts.ArrowFunction): boolean {
  const call = arrow.parent;
  if (!call || !tsm.isCallExpression(call)) return false;
  if (!call.arguments.includes(arrow)) return false;
  const callee = call.expression;
  if (tsm.isIdentifier(callee) && callee.text === "expr") return true;
  if (tsm.isPropertyAccessExpression(callee) && QUERY_METHODS.has(callee.name.text)) {
    return isQueryReceiver(checker, callee.expression);
  }
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
        const program = ls.getProgram();
        const sourceFile = program?.getSourceFile(fileName);
        if (!program || !sourceFile) return prior;
        const checker = program.getTypeChecker();

        const extra: ts.Diagnostic[] = [];
        const visit = (node: ts.Node): void => {
          if (tsm.isArrowFunction(node) && isQueryLambda(tsm, checker, node)) {
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
