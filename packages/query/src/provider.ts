import type { QueryPlan } from "./plan.js";

/**
 * What a provider declares it can translate. The `Queryable` capability
 * pre-check compares the folded plan against this and fails fast
 * with a located error before any I/O.
 */
export interface Capabilities {
  /** Plan op kinds the provider can honor (`filter`, `orderBy`, `join`, …). */
  readonly ops: ReadonlySet<string>;
  /** WellKnown call names the provider translates; omit for "everything (memory)". */
  readonly calls?: ReadonlySet<string>;
}

export interface QueryProvider {
  readonly name: string;
  capabilities(): Capabilities;
  execute<T>(plan: QueryPlan, signal?: AbortSignal): Promise<T>;
  explain?(plan: QueryPlan): Promise<string>;
}

/** Build a {@link Capabilities} from plain arrays (ergonomic for providers). */
export function capabilities(ops: string[], calls?: string[]): Capabilities {
  return {
    ops: new Set(ops),
    ...(calls ? { calls: new Set(calls) } : {}),
  };
}
