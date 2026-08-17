import { type Expr, expr } from "@treequel/core";
import type { Doc, Viewer } from "./schema.js";

/**
 * The one policy rule: a viewer sees a document when it belongs to their org
 * and is not archived — unless the viewer is an admin, who also sees archived
 * ones. Written once as a lambda over the row; the viewer arrives through the
 * closure and folds into the tree at execution time.
 */
export const canSee = (viewer: Viewer): Expr<(d: Doc) => boolean> =>
  expr((d: Doc) => d.orgId === viewer.orgId && (!d.archived || viewer.role === "admin"));
