/**
 * Navigation metadata for `include()`. Relations are declared once, next to the
 * schema type, and passed to `createContext`; `include()` resolves navigation
 * names against them and embeds the result in the plan as self-contained
 * `IncludeSpec` data — providers never read this metadata.
 */

/** One navigation: how rows of the declaring source reach rows of `target`. */
export interface Relation {
  /** `"many"` loads an array of related rows; `"one"` loads a single row or `null`. */
  readonly kind: "one" | "many";
  /** Source name of the related rows. */
  readonly target: string;
  /** Key property on the declaring row. */
  readonly from: string;
  /** Key property on the target row. */
  readonly to: string;
}

/** Runtime shape: source name → navigation property name → relation. */
export type RelationsMeta = Readonly<Record<string, Readonly<Record<string, Relation>>>>;

/**
 * Typed relation map for a schema: navigation names must be properties of the
 * declaring row type, `target` a schema source, and `from`/`to` keys of the
 * respective row types. Declare navigation properties as optional on the row
 * types (`orders?: Order[]`), and `include()` marks them loaded.
 */
export type SchemaRelations<S> = {
  readonly [Src in keyof S]?: {
    readonly [Nav in keyof S[Src] & string]?: {
      [T in keyof S]: {
        readonly kind: "one" | "many";
        readonly target: T & string;
        readonly from: keyof S[Src] & string;
        readonly to: keyof S[T] & string;
      };
    }[keyof S];
  };
};

/** Identity at runtime; exists to typecheck the relation map against `S`. */
export function defineRelations<S>(relations: SchemaRelations<S>): SchemaRelations<S> {
  return relations;
}
