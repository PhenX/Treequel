/**
 * Compile a whole plan to one parameterized statement. {@link compile} folds
 * the query ops into a layer, then wraps the executor (`toArray`,
 * `first`/`single`, `count`, `some`/`every`, `sum`/`min`/`max`/`avg`) around it,
 * returning the SQL text, its values, and a `post` step that shapes the rows.
 */
import { TreequelError } from "@treequel/core";
import {
  type AnyExpr,
  type IncludeSpec,
  type PlanOp,
  type QueryPlan,
  collectIncludes,
} from "@treequel/query";
import { Compiler } from "./compiler.js";
import { SCALAR_COLUMN, finalizeSql, quoteIdent } from "./context.js";
import type { SqlDialect } from "./dialect.js";
import { type SchemaMeta, physicalColumn } from "./schema.js";

export interface Compiled {
  readonly text: string;
  readonly values: unknown[];
  readonly post: (rows: Array<Record<string, unknown>>) => unknown;
  /** Row-shaped results (`toArray`/`first`/`single`) can carry includes. */
  readonly rowKind: "toArray" | "one" | null;
  readonly includes: readonly IncludeSpec[];
  /** Maps a logical key property to its name on the result rows. */
  readonly keyProp: (logical: string) => string;
}

export function compile(plan: QueryPlan, schema: SchemaMeta, dialect: SqlDialect): Compiled {
  const compiler = new Compiler(schema, dialect, plan.relations);
  const includes = collectIncludes(plan.ops);
  let exec: Extract<PlanOp, { op: "exec" }> | null = null;

  let layer = compiler.freshLayer(plan.source);
  for (const op of plan.ops) {
    if (op.op === "include") continue;
    if (op.op === "exec") {
      exec = op;
      continue;
    }
    layer = compiler.foldOp(layer, op);
  }

  const kind = exec?.kind ?? "toArray";
  if (layer.pendingGroup && (kind === "toArray" || kind === "first" || kind === "single")) {
    throw new TreequelError(
      "R2001",
      "Materializing raw groups is memory-only (v1) — project them with select(g => …) first.",
    );
  }
  const withPred = (negate = false): void => {
    if (exec?.expr) {
      const e = exec.expr;
      layer = compiler.foldWhere(layer, (l) => {
        const cond = compiler.translateWith(e, l.shape);
        return negate ? `(NOT ${cond})` : cond;
      });
    }
  };

  // Assembled after the exec is folded, so closures see the final layer.
  const emit = (
    rawText: string,
    post: Compiled["post"],
    rowKind: Compiled["rowKind"],
  ): Compiled => {
    const final = finalizeSql(rawText, compiler.ctx.values, dialect);
    const keyProp = (logical: string): string =>
      layer.shape.kind === "table" && layer.projection === null
        ? physicalColumn(layer.shape.meta, logical)
        : logical;
    return { text: final.text, values: final.values, post, rowKind, includes, keyProp };
  };
  const mapRow = (r: Record<string, unknown>): unknown => (layer.scalar ? r[SCALAR_COLUMN] : r);
  /** `SELECT 1` body for row-existence/count shells, unless shaping matters. */
  const innerSelect = (): string =>
    layer.projection === null && !layer.distinct
      ? compiler.render(layer, "1")
      : compiler.render(layer);

  switch (kind) {
    case "toArray":
      return emit(compiler.render(layer), (rows) => rows.map(mapRow), "toArray");

    case "first":
    case "single": {
      withPred();
      layer = compiler.foldTake(layer, kind === "first" ? 1 : 2);
      const orNull = exec?.orNull ?? false;
      return emit(
        compiler.render(layer),
        (rows) => {
          if (kind === "single" && rows.length > 1) {
            throw new Error("Treequel: single() found more than one element.");
          }
          if (rows.length === 0) {
            if (orNull) return null;
            throw new Error(`Treequel: ${kind}() found no element.`);
          }
          return mapRow(rows[0] as Record<string, unknown>);
        },
        "one",
      );
    }

    case "count": {
      withPred();
      return emit(
        `SELECT ${dialect.floatCast("COUNT(*)")} AS ${quoteIdent(SCALAR_COLUMN)} FROM (${innerSelect()}) ${quoteIdent(compiler.alias("d"))}`,
        (rows) => Number(rows[0]?.[SCALAR_COLUMN] ?? 0),
        null,
      );
    }

    case "some":
    case "every": {
      withPred(kind === "every"); // ∀p ≡ ¬∃¬p
      const not = kind === "every" ? "NOT " : "";
      return emit(
        `SELECT ${not}EXISTS(${innerSelect()}) AS ${quoteIdent(SCALAR_COLUMN)}`,
        (rows) => Boolean(rows[0]?.[SCALAR_COLUMN]),
        null,
      );
    }

    case "sum":
    case "min":
    case "max":
    case "avg": {
      const wrapped = compiler.wrap(layer);
      const selector = compiler.translateWith(exec?.expr as AnyExpr, wrapped.shape);
      const agg =
        kind === "sum"
          ? dialect.floatCast(`COALESCE(SUM(${selector}), 0)`)
          : kind === "avg"
            ? dialect.floatCast(`AVG(${selector})`)
            : `${kind.toUpperCase()}(${selector})`;
      return emit(
        `SELECT ${agg} AS ${quoteIdent(SCALAR_COLUMN)} FROM ${wrapped.from}`,
        (rows) => {
          const v = rows[0]?.[SCALAR_COLUMN];
          if (v === null || v === undefined) return kind === "sum" ? 0 : null;
          return Number(v);
        },
        null,
      );
    }
  }
}
