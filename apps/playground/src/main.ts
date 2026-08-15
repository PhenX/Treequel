import { __expr, type Node, print } from "@treequel/core";
import { parseFunctionSource } from "@treequel/fallback";
import { createContext } from "@treequel/linq";
import { type SchemaMeta, postgres } from "@treequel/provider-postgres";
import { emitNode } from "@treequel/transform/emit";
import { serialize } from "@treequel/tree";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const lambdaEl = $("lambda") as HTMLTextAreaElement;
const capturesEl = $("captures") as HTMLTextAreaElement;
const diagnosticsEl = $("diagnostics");
const prettyEl = $("pretty");
const emittedEl = $("emitted");
const sqlEl = $("sql");
const jsonEl = $("json");

// A provider whose executor is never called — we only render explain() text.
const noExec = async (): Promise<{ rows: Array<Record<string, unknown>> }> => ({ rows: [] });
const schema: SchemaMeta = { users: { table: "users" } };
const db = createContext<{ users: unknown }>(postgres(noExec, schema)) as {
  users: {
    where(e: unknown): { explain(): Promise<string> };
    select(e: unknown): { explain(): Promise<string> };
  };
};

function readCaptures(): Record<string, unknown> {
  const text = capturesEl.value.trim();
  if (text === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function renderDiagnostics(
  diags: ReadonlyArray<{ code: string; severity: string; message: string; hint?: string }>,
): void {
  if (diags.length === 0) {
    diagnosticsEl.innerHTML = `<span class="ok">✓ valid — inside the expression subset</span>`;
    return;
  }
  diagnosticsEl.innerHTML = diags
    .map(
      (d) =>
        `<div class="diag ${d.severity}"><a href="/Treequel/errors#${d.code}">${d.code}</a> ${escapeHtml(
          d.message,
        )}${d.hint ? `<span class="diag-hint">${escapeHtml(d.hint)}</span>` : ""}</div>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function emittedShape(
  src: string,
  params: readonly string[],
  body: Node,
  freeVars: readonly string[],
): string {
  const scope = freeVars.length > 0 ? `{ ${freeVars.join(", ")} }` : "{}";
  return [
    "__tql_expr$({",
    "  v: 1,",
    `  compiled: ${src},`,
    `  params: ${JSON.stringify(params)},`,
    `  body: ${emitNode(body)},`,
    `  scope: () => (${scope}),`,
    "})",
  ].join("\n");
}

async function render(): Promise<void> {
  const src = lambdaEl.value.trim();
  const captures = readCaptures();

  let result;
  try {
    result = parseFunctionSource(src);
  } catch (e) {
    renderDiagnostics([{ code: "R1100", severity: "error", message: (e as Error).message }]);
    prettyEl.textContent = emittedEl.textContent = sqlEl.textContent = jsonEl.textContent = "—";
    return;
  }

  renderDiagnostics(result.diagnostics);

  if (!result.body) {
    prettyEl.textContent = emittedEl.textContent = sqlEl.textContent = jsonEl.textContent = "—";
    return;
  }
  const body = result.body;

  prettyEl.textContent = print(body);
  emittedEl.textContent = emittedShape(src, result.params, body, result.freeVars);
  jsonEl.textContent = JSON.stringify(serialize(body), null, 2);

  // Build a real Expr and ask the SQL provider for the statement it would run.
  try {
    const expr = __expr({
      v: 1,
      compiled: (() => undefined) as (...a: never[]) => unknown,
      params: result.params,
      body,
      scope: () => captures,
    });
    const query = body.kind === "ObjectLit" ? db.users.select(expr) : db.users.where(expr);
    sqlEl.textContent = await query.explain();
    sqlEl.classList.remove("error");
  } catch (e) {
    sqlEl.textContent = (e as Error).message;
    sqlEl.classList.add("error");
  }
}

lambdaEl.addEventListener("input", () => void render());
capturesEl.addEventListener("input", () => void render());
void render();
