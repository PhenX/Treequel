import { type Expr, expr } from "@greffon/core";
import type { AppEvent } from "./events.js";

/**
 * The sending side's definition: a saved search over events, with the
 * threshold captured from the enclosing scope. Folding the capture before
 * serializing makes the tree self-contained on the wire.
 */
export const bigPurchases = (threshold: number): Expr<(e: AppEvent) => boolean> =>
  expr((e: AppEvent) => e.type === "purchase" && e.amount >= threshold);
