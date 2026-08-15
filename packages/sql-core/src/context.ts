/**
 * Translation infrastructure shared by every SQL dialect: how a lambda
 * parameter resolves to a column ({@link ColumnShape}), the per-statement
 * {@link TranslateContext} that threads parameter values and the navigation
 * env, and the small helpers ({@link finalizeSql}, {@link quoteIdent},
 * {@link shapeColumn}) the translator and compiler build on.
 */
import { TreequelError } from "@treequel/core";
import type { RelationsMeta } from "@treequel/linq";
import { type SchemaMeta, type TableMeta, physicalColumn } from "./schema.js";
import type { SqlDialect } from "./dialect.js";

/**
 * How a lambda parameter resolves to SQL. A `table` shape maps properties
 * through schema meta to physical columns (`source` is its logical source
 * name, for navigation lookup); a `derived` shape maps them to the output
 * aliases of a subquery projection; a `scalar` shape is a single-value row
 * (`SELECT expr AS "value"`) whose parameter *is* the value.
 */
export type ColumnShape =
  | {
      readonly kind: "table";
      readonly alias: string;
      readonly meta: TableMeta;
      readonly source?: string;
    }
  | { readonly kind: "derived"; readonly alias: string; readonly columns: readonly string[] | null }
  | { readonly kind: "scalar"; readonly alias: string }
  | {
      /** The `g` of a group projection: `key` parts plus the pre-group row shape. */
      readonly kind: "group";
      readonly keyParts: ReadonlyArray<{ readonly name: string | null; readonly sql: string }>;
      readonly item: ColumnShape;
    };

/** Statement-wide surroundings for navigation subqueries (`EXISTS`). */
export interface TranslateEnv {
  readonly relations?: RelationsMeta;
  readonly schema?: SchemaMeta;
  /** Allocate a statement-unique table alias. */
  readonly alias?: () => string;
}

/** Column name a scalar subquery projects its value under. */
export const SCALAR_COLUMN = "value";

// NUL delimits value markers: it cannot appear in generated SQL text, so a
// marker never collides with identifiers, keywords, or literals.
const NUL = String.fromCharCode(0);
const MARKER = new RegExp(`${NUL}(\\d+)${NUL}`, "g");

/**
 * State threaded through a single SQL statement's translation. `param()` emits
 * a position-independent marker; {@link finalizeSql} rewrites markers to the
 * dialect's placeholders in *textual* order and reorders the values to match —
 * translation order and clause order are free to differ (they do: a `WHERE`
 * folds before the `SELECT` list that precedes it in the statement).
 */
export class TranslateContext {
  readonly values: unknown[];
  readonly env: TranslateEnv;
  private readonly shapes: ReadonlyMap<string, ColumnShape> | ColumnShape;
  private readonly parent?: TranslateContext;

  constructor(
    readonly dialect: SqlDialect,
    shapes: ReadonlyMap<string, ColumnShape> | ColumnShape,
    readonly loc?: string,
    values: unknown[] = [],
    env: TranslateEnv = {},
    parent?: TranslateContext,
  ) {
    this.shapes = shapes;
    this.values = values;
    this.env = env;
    this.parent = parent;
  }

  /**
   * A context over new parameter bindings that shares this statement's values
   * and env. The current bindings stay visible as the lexical parent scope, so
   * a nested navigation lambda can still reference the outer row.
   */
  scoped(shapes: ReadonlyMap<string, ColumnShape> | ColumnShape): TranslateContext {
    return new TranslateContext(this.dialect, shapes, this.loc, this.values, this.env, this);
  }

  /** Resolve a lambda parameter. A single (non-map) shape binds every parameter. */
  shapeOf(param: string): ColumnShape | undefined {
    if (this.shapes instanceof Map) {
      return this.shapes.get(param) ?? this.parent?.shapeOf(param);
    }
    return this.shapes as ColumnShape;
  }

  param(value: unknown): string {
    this.values.push(value);
    return `${NUL}${this.values.length - 1}${NUL}`;
  }

  private located(detail: string): string {
    return this.loc ? `${detail} (${this.loc})` : detail;
  }

  fail(code: string, detail: string): never {
    throw new TreequelError(code, this.located(detail));
  }
}

/** Rewrite param markers to dialect placeholders in textual order. */
export function finalizeSql(
  text: string,
  values: readonly unknown[],
  dialect: SqlDialect,
): { text: string; values: unknown[] } {
  const ordered: unknown[] = [];
  const finalText = text.replace(MARKER, (_m, index: string) => {
    ordered.push(values[Number(index)]);
    return dialect.placeholder(ordered.length);
  });
  return { text: finalText, values: ordered };
}

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Column reference for `prop` on rows of the given shape. */
export function shapeColumn(shape: ColumnShape, prop: string, ctx: TranslateContext): string {
  switch (shape.kind) {
    case "table":
      return `${quoteIdent(shape.alias)}.${quoteIdent(physicalColumn(shape.meta, prop))}`;
    case "derived":
      if (shape.columns && !shape.columns.includes(prop)) {
        return ctx.fail("R2002", `Column '${prop}' is not part of the projected row.`);
      }
      return `${quoteIdent(shape.alias)}.${quoteIdent(prop)}`;
    case "scalar":
      return ctx.fail("R2002", `A scalar row has no column '${prop}'.`);
    case "group":
      return ctx.fail("R2002", `A group has no column '${prop}' — project from g.key and g.items.`);
  }
}
