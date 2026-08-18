import type { SchemaMeta } from "@greffon/provider-postgres";

export interface User {
  id: number;
  name: string;
  age: number;
  active: boolean;
  city: string | null;
}
export interface Order {
  id: number;
  userId: number;
  total: number;
}
export interface Schema {
  users: User;
  orders: Order;
}

/** Explicit, minimal schema metadata (logical → physical column mapping). */
export const schemaMeta: SchemaMeta = {
  users: { table: "users" },
  orders: { table: "orders", columns: { userId: "user_id" } },
};

export const users: User[] = [
  { id: 1, name: "Ada", age: 36, active: true, city: "London" },
  { id: 2, name: "Alan", age: 41, active: false, city: "London" },
  { id: 3, name: "Grace", age: 45, active: true, city: null },
  { id: 4, name: "Bob", age: 17, active: true, city: "NYC" },
];
export const orders: Order[] = [
  { id: 1, userId: 1, total: 10.5 },
  { id: 2, userId: 1, total: 20 },
  { id: 3, userId: 3, total: 5 },
];
