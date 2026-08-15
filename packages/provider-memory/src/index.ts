/**
 * `@treequel/provider-memory` — the reference provider. It applies each
 * op with the native JS equivalent via `expr.compiled`, never the tree. This is
 * the semantics every other provider's conformance suite is asserted against
 *. It is a thin wrapper over the shared engine in `@treequel/linq`.
 */
import {
  type Capabilities,
  type QueryPlan,
  type QueryProvider,
  PLAN_OP_KINDS,
  capabilities,
  runPlanInMemory,
} from "@treequel/linq";
import { TreequelError } from "@treequel/core";

export interface MemoryData {
  readonly [source: string]: readonly unknown[];
}

/** Build an in-memory provider over fixture arrays keyed by source name. */
export function memoryProvider(data: MemoryData): QueryProvider {
  const rows = (source: string): readonly unknown[] => {
    const arr = data[source];
    if (!arr) {
      throw new TreequelError("R2002", `Unknown source '${source}' in the in-memory provider.`);
    }
    return arr;
  };

  return {
    name: "memory",
    capabilities(): Capabilities {
      return capabilities([...PLAN_OP_KINDS]);
    },
    async execute<T>(plan: QueryPlan): Promise<T> {
      return runPlanInMemory(plan, rows) as T;
    },
    async explain(plan: QueryPlan): Promise<string> {
      return `memory scan: ${plan.source} (${plan.ops.map((o) => o.op).join(" → ") || "scan"})`;
    },
  };
}
