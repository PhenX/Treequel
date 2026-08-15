import { __expr, type Node, print } from "@treequel/core";
import { parseFunctionSource } from "@treequel/fallback";
import { createContext, defineRelations } from "@treequel/linq";
import { type SchemaMeta, postgres } from "@treequel/provider-postgres";
import { emitNode } from "@treequel/transform/emit";
import { serialize } from "@treequel/tree";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const samplesEl = $("samples");
const lambdaEl = $("lambda") as HTMLTextAreaElement;
const capturesEl = $("captures") as HTMLTextAreaElement;
const diagnosticsEl = $("diagnostics");
const prettyEl = $("pretty");
const emittedEl = $("emitted");
const sqlEl = $("sql");
const jsonEl = $("json");

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
    where(e: unknown): { explain(): Promise<string> };
    select(e: unknown): { explain(): Promise<string> };
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
      lambdaEl.value = sample.lambda;
      capturesEl.value = sample.captures;
      void render();
    });
    samplesEl.appendChild(button);
  }
}

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

renderSamples();
lambdaEl.addEventListener("input", () => void render());
capturesEl.addEventListener("input", () => void render());
void render();
