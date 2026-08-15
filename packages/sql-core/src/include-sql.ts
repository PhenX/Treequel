/**
 * Split-query loading for `include`. Each navigation is one batched fetch —
 * `= ANY($n)` on Postgres or chunked `IN (…)` on SQLite, with an optional
 * per-parent `ROW_NUMBER()` slice — stitched onto the parent rows by the shared
 * engine in `@treequel/linq`, so no join duplication ever inflates the parent
 * set. {@link explainIncludes} renders the same plan as comment lines.
 */
import { TreequelError } from "@treequel/core";
import { type IncludeSpec, type RelationsMeta, attachChildren, collectKeys } from "@treequel/linq";
import { Compiler } from "./compiler.js";
import { finalizeSql, quoteIdent, shapeColumn } from "./context.js";
import type { SqlDialect } from "./dialect.js";
import { type SchemaMeta, physicalColumn } from "./schema.js";

/** A driver-agnostic query runner. */
export type SqlExecutor = (
  text: string,
  values: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Fetch one chunk of related rows, applying the spec's refinement ops. */
async function fetchRefinedChunk(
  spec: IncludeSpec,
  chunk: readonly unknown[],
  schema: SchemaMeta,
  dialect: SqlDialect,
  executor: SqlExecutor,
  relations: RelationsMeta | undefined,
): Promise<Array<Record<string, unknown>>> {
  const compiler = new Compiler(schema, dialect, relations);
  let layer = compiler.freshLayer(spec.target);
  const orderParts: string[] = [];
  for (const op of spec.ops ?? []) {
    if (op.op === "where") {
      layer = compiler.foldWhere(layer, (l) => compiler.translateWith(op.expr, l.shape));
    } else if (op.op === "orderBy" || op.op === "thenBy") {
      orderParts.push(
        `${compiler.translateWith(op.expr, layer.shape)} ${op.desc ? "DESC" : "ASC"}${dialect.nullsSuffix(op.desc)}`,
      );
    } else {
      throw new TreequelError(
        "R2001",
        `An include refinement supports where/orderBy only (got '${op.op}').`,
      );
    }
  }
  layer = compiler.foldWhere(layer, (l) => {
    const col = shapeColumn(l.shape, spec.to, compiler.ctx);
    return dialect.arrayContains(col, chunk, compiler.ctx);
  });

  let raw: string;
  if (spec.take !== undefined || spec.skip !== undefined) {
    if (dialect.windowFunctions === false) {
      throw new TreequelError(
        "R2001",
        `Per-parent include slices need window functions, which the ${dialect.name} dialect disables.`,
      );
    }
    // Per-parent slice: number the rows inside each parent's partition.
    const alias = quoteIdent(layer.shape.alias);
    const partition = shapeColumn(layer.shape, spec.to, compiler.ctx);
    const over = `PARTITION BY ${partition}${orderParts.length > 0 ? ` ORDER BY ${orderParts.join(", ")}` : ""}`;
    const inner = compiler.render(
      layer,
      `${alias}.*, ROW_NUMBER() OVER (${over}) AS ${quoteIdent(ROW_MARK)}`,
    );
    const lo = spec.skip ?? 0;
    const hi = spec.take !== undefined ? lo + spec.take : null;
    const w = quoteIdent("w");
    const rn = `${w}.${quoteIdent(ROW_MARK)}`;
    raw = `SELECT ${w}.* FROM (${inner}) ${w} WHERE ${rn} > ${lo}${hi !== null ? ` AND ${rn} <= ${hi}` : ""} ORDER BY ${partitionAlias(partition, w)}, ${rn}`;
  } else {
    layer.orderBy.push(...orderParts);
    raw = compiler.render(layer);
  }

  const { text, values } = finalizeSql(raw, compiler.ctx.values, dialect);
  const result = await executor(
    text,
    values.map((v) => dialect.coerceValue(v)),
  );
  return result.rows;
}

const ROW_MARK = "__tql_rn";

/** Rewrite an inner column reference to the wrapper alias for the outer ORDER BY. */
function partitionAlias(partition: string, wrapper: string): string {
  const dot = partition.lastIndexOf(".");
  return `${wrapper}${dot === -1 ? `.${partition}` : partition.slice(dot)}`;
}

/** Fetch and attach each navigation, one level at a time, via batched split queries. */
export async function stitchIncludes(
  parents: unknown[],
  specs: readonly IncludeSpec[],
  keyProp: (logical: string) => string,
  schema: SchemaMeta,
  dialect: SqlDialect,
  executor: SqlExecutor,
  relations: RelationsMeta | undefined,
): Promise<unknown[]> {
  let cur = parents;
  for (const spec of specs) {
    if (cur.length === 0) break;
    const parentProp = keyProp(spec.from);
    const meta = schema[spec.target];
    if (!meta) throw new TreequelError("R2002", `No schema meta for source '${spec.target}'.`);
    const childProp = physicalColumn(meta, spec.to);
    const keys = collectKeys(cur, parentProp, spec.nav);
    let children: unknown[] = [];
    if (keys.length > 0) {
      const batch = dialect.maxBatchKeys ?? keys.length;
      for (let i = 0; i < keys.length; i += batch) {
        const chunk = keys.slice(i, i + batch);
        const rows = await fetchRefinedChunk(spec, chunk, schema, dialect, executor, relations);
        for (const row of rows) {
          delete row[ROW_MARK];
          children.push(row);
        }
      }
    }
    if (spec.children && spec.children.length > 0) {
      children = await stitchIncludes(
        children,
        spec.children,
        (logical) => physicalColumn(meta, logical),
        schema,
        dialect,
        executor,
        relations,
      );
    }
    // SQL already applied the per-parent slice in the window fetch.
    const { take: _take, skip: _skip, ...attachSpec } = spec;
    const ordered = spec.ops?.some((o) => o.op === "orderBy") ?? false;
    cur = attachChildren(cur, attachSpec, children, parentProp, childProp, ordered);
  }
  return cur;
}

export function explainIncludes(
  specs: readonly IncludeSpec[],
  schema: SchemaMeta,
  depth = 0,
): string {
  let out = "";
  for (const spec of specs) {
    const meta = schema[spec.target];
    const table = meta?.table ?? spec.target;
    const keyCol = meta ? physicalColumn(meta, spec.to) : spec.to;
    out += `\n-- include ${"  ".repeat(depth)}${spec.nav}: batched SELECT FROM ${quoteIdent(table)} WHERE ${quoteIdent(keyCol)} IN (parent keys)`;
    if (spec.children) out += explainIncludes(spec.children, schema, depth + 1);
  }
  return out;
}
