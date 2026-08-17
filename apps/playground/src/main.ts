import { __expr, evaluate, type Node, print } from "@treequel/core";
import { parseFunctionSource } from "@treequel/fallback";
import { createContext, defineRelations } from "@treequel/query";
import { type SchemaMeta, postgres } from "@treequel/provider-postgres";
import { emitNode } from "@treequel/transform/emit";
import { serialize } from "@treequel/tree";
import {
  diagnosticMarkers,
  parseErrorInfo,
  parseErrorMarkers,
  setMarkers,
  type SpanDiagnostic,
} from "./markers.js";
import { TS_LANGUAGE, type Mounted, mountEditor } from "./monaco.js";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const samplesEl = $("samples");
const diagnosticsEl = $("diagnostics");

const INITIAL_LAMBDA = "u => u.age >= minAge && u.name.startsWith(prefix)";
const INITIAL_CAPTURES = '{ "minAge": 18, "prefix": "A" }';
const INITIAL_ROW = `{
  "id": 1, "name": "Ada", "age": 36, "active": true, "city": "London",
  "orders": [{ "id": 1, "userId": 1, "total": 250, "paid": true,
               "items": [{ "id": 1, "orderId": 1, "sku": "apple" }] }]
}`;
const EMPTY = "—";

// The lambda editor uses the Monarch TypeScript mode so arrows, optional chaining
// and `as` casts all colorize; the SQL viewer is `pgsql` to match the Postgres
// text it renders.
const lambda = mountEditor($("lambda"), {
  language: TS_LANGUAGE,
  value: INITIAL_LAMBDA,
  ariaLabel: "Query lambda",
  minHeight: 72,
  maxHeight: 220,
});
const captures = mountEditor($("captures"), {
  language: "json",
  value: INITIAL_CAPTURES,
  ariaLabel: "Captured values as JSON",
  minHeight: 44,
  maxHeight: 160,
});
const row = mountEditor($("row"), {
  language: "json",
  value: INITIAL_ROW,
  ariaLabel: "Sample row as JSON",
  minHeight: 44,
  maxHeight: 160,
});
const prettyViewer = viewer("pretty", TS_LANGUAGE);
const evaluatedViewer = viewer("evaluated", "json");
const emittedViewer = viewer("emitted", TS_LANGUAGE);
const sqlViewer = viewer("sql", "pgsql");
const jsonViewer = viewer("json", "json");
const sqlPanel = sqlViewer.editor.getContainerDomNode().closest(".panel") as HTMLElement;
const evaluatedPanel = evaluatedViewer.editor
  .getContainerDomNode()
  .closest(".panel") as HTMLElement;

function viewer(id: string, language: string): Mounted {
  return mountEditor($(id), {
    language,
    value: EMPTY,
    readOnly: true,
    lineNumbers: true,
    maxHeight: 420,
  });
}

// The demo schema: users → orders → items, with mapped physical columns so
// the SQL panel shows the logical→physical translation too.
interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
  city: string | null;
  orders?: OrderRow[];
}
interface OrderRow {
  id: number;
  userId: number;
  total: number;
  paid: boolean;
  user?: User | null;
  items?: ItemRow[];
}
interface ItemRow {
  id: number;
  orderId: number;
  sku: string;
  order?: OrderRow | null;
}
interface Schema {
  users: User;
  orders: OrderRow;
  items: ItemRow;
}

const schema: SchemaMeta = {
  users: { table: "users" },
  orders: { table: "orders", columns: { userId: "user_id" } },
  items: { table: "items", columns: { orderId: "order_id" } },
};

const relations = defineRelations<Schema>({
  users: {
    orders: { kind: "many", target: "orders", from: "id", to: "userId" },
  },
  orders: {
    user: { kind: "one", target: "users", from: "userId", to: "id" },
    items: { kind: "many", target: "items", from: "id", to: "orderId" },
  },
  items: {
    order: { kind: "one", target: "orders", from: "orderId", to: "id" },
  },
});

// A provider whose executor is never called — we only render explain() text.
const noExec = async (): Promise<{ rows: Array<Record<string, unknown>> }> => ({ rows: [] });
const db = createContext<Schema>(postgres(noExec, schema), { relations }) as unknown as {
  users: {
    filter(e: unknown): { explain(): Promise<string> };
    map(e: unknown): { explain(): Promise<string> };
  };
};

interface Sample {
  readonly label: string;
  readonly lambda: string;
  readonly captures: string;
}

const SAMPLES: readonly Sample[] = [
  {
    label: "Filter",
    lambda: "u => u.age >= minAge && u.name.startsWith(prefix)",
    captures: '{ "minAge": 18, "prefix": "A" }',
  },
  {
    label: "Projection",
    lambda: "u => ({ id: u.id, shout: u.name.toUpperCase() })",
    captures: "",
  },
  {
    label: "Null checks",
    lambda: "u => u.city === null",
    captures: "",
  },
  {
    label: "Membership",
    lambda: "u => cities.includes(u.city)",
    captures: '{ "cities": ["London", "Paris"] }',
  },
  {
    label: "Ternary",
    lambda: 'u => ({ name: u.name, tier: u.age > limit ? "senior" : "junior" })',
    captures: '{ "limit": 30 }',
  },
  {
    label: "Policy rule",
    lambda: 'u => u.city === viewer.city || viewer.role === "admin"',
    captures: '{ "viewer": { "city": "London", "role": "member" } }',
  },
  {
    label: "some → EXISTS",
    lambda: "u => u.orders?.some(o => o.total > min)",
    captures: '{ "min": 100 }',
  },
  {
    label: "every → NOT EXISTS",
    lambda: "u => u.active && u.orders?.every(o => o.paid)",
    captures: "",
  },
  {
    label: "Nested relations",
    lambda: "u => u.orders?.some(o => o.items?.some(i => i.sku === sku))",
    captures: '{ "sku": "apple" }',
  },
  {
    label: "Count relation",
    lambda: "u => ({ name: u.name, orderCount: u.orders?.length ?? 0 })",
    captures: "",
  },
  {
    label: "Filtered count",
    lambda: "u => ({ name: u.name, big: u.orders?.filter(o => o.total > min).length ?? 0 })",
    captures: '{ "min": 100 }',
  },
  {
    label: "Sum relation",
    lambda: "u => ({ name: u.name, spent: u.orders?.reduce((acc, o) => acc + o.total, 0) ?? 0 })",
    captures: "",
  },
];

function renderSamples(): void {
  for (const sample of SAMPLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sample";
    button.textContent = sample.label;
    button.addEventListener("click", () => {
      lambda.setValue(sample.lambda);
      captures.setValue(sample.captures);
      void render();
    });
    samplesEl.appendChild(button);
  }
}

function readCaptures(): Record<string, unknown> {
  const text = captures.model.getValue().trim();
  if (text === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readRow(): unknown {
  const text = row.model.getValue().trim();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function renderDiagnostics(diags: readonly SpanDiagnostic[]): void {
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

function clearOutputs(): void {
  prettyViewer.setValue(EMPTY);
  evaluatedViewer.setValue(EMPTY, "json");
  emittedViewer.setValue(EMPTY);
  jsonViewer.setValue(EMPTY, "json");
  sqlViewer.setValue(EMPTY, "pgsql");
  sqlPanel.classList.remove("error");
  evaluatedPanel.classList.remove("error");
}

async function render(): Promise<void> {
  const source = lambda.model.getValue();
  const src = source.trim();
  const capturedValues = readCaptures();

  let result;
  try {
    result = parseFunctionSource(src);
  } catch (e) {
    const info = parseErrorInfo(e);
    renderDiagnostics([{ code: "R1100", severity: "error", message: info.message }]);
    setMarkers(lambda.model, parseErrorMarkers(lambda.model, source, info));
    clearOutputs();
    return;
  }

  renderDiagnostics(result.diagnostics);
  setMarkers(lambda.model, diagnosticMarkers(lambda.model, source, result.diagnostics));

  if (!result.body) {
    clearOutputs();
    return;
  }
  const body = result.body;

  prettyViewer.setValue(print(body));
  emittedViewer.setValue(emittedShape(src, result.params, body, result.freeVars));
  jsonViewer.setValue(JSON.stringify(serialize(body), null, 2), "json");

  // Interpret the tree against the sample row — the browser-side life of the
  // lambda: no compiled function, no provider, no SQL.
  try {
    const value: unknown = evaluate(body, {
      params: { [result.params[0] ?? "u"]: readRow() },
      scope: capturedValues,
    });
    evaluatedViewer.setValue(
      value === undefined ? "undefined" : JSON.stringify(value, null, 2),
      "json",
    );
    evaluatedPanel.classList.remove("error");
  } catch (e) {
    evaluatedViewer.setValue((e as Error).message, "plaintext");
    evaluatedPanel.classList.add("error");
  }

  // Build a real Expr and ask the SQL provider for the statement it would run.
  try {
    const expr = __expr({
      v: 1,
      compiled: (() => undefined) as (...a: never[]) => unknown,
      params: result.params,
      body,
      scope: () => capturedValues,
    });
    // oxlint-disable-next-line treequel/no-opaque-callback -- `expr` holds a reified Expr value, not a function reference
    const query = body.kind === "ObjectLit" ? db.users.map(expr) : db.users.filter(expr);
    sqlViewer.setValue(await query.explain(), "pgsql");
    sqlPanel.classList.remove("error");
  } catch (e) {
    sqlViewer.setValue((e as Error).message, "plaintext");
    sqlPanel.classList.add("error");
  }
}

renderSamples();
lambda.editor.onDidChangeModelContent(() => void render());
captures.editor.onDidChangeModelContent(() => void render());
row.editor.onDidChangeModelContent(() => void render());
void render();
