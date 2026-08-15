/** Minimal, explicit schema metadata (no introspection in v1). */
export interface TableMeta {
  /** Physical table name. */
  readonly table: string;
  /** Logical→physical column map (e.g. `{ createdAt: "created_at" }`). Unmapped names pass through. */
  readonly columns?: Readonly<Record<string, string>>;
  /** Columns whose deep member access compiles to JSONB path extraction. */
  readonly json?: readonly string[];
}

export type SchemaMeta = Readonly<Record<string, TableMeta>>;

export function physicalColumn(meta: TableMeta, logical: string): string {
  return meta.columns?.[logical] ?? logical;
}
