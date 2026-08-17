import type { SchemaMeta } from "@treequel/provider-postgres";

export interface Doc {
  id: number;
  orgId: number;
  title: string;
  archived: boolean;
}
export interface Viewer {
  orgId: number;
  role: "admin" | "member";
}
export interface Schema {
  docs: Doc;
}

export const schemaMeta: SchemaMeta = {
  docs: { table: "docs", columns: { orgId: "org_id" } },
};

export const docs: Doc[] = [
  { id: 1, orgId: 1, title: "Roadmap", archived: false },
  { id: 2, orgId: 1, title: "Old plan", archived: true },
  { id: 3, orgId: 2, title: "Other org", archived: false },
];
