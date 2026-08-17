import { type Context, expr } from "@treequel/query";
import type { Schema, User } from "./schema.js";

/**
 * Query definitions, written once, provider-agnostic. The lambdas are reified
 * into expression trees by the Treequel build plugin (here via `expr()`, which
 * is reified regardless of taint). Pass any `Context` — memory or Postgres — and
 * the same definitions execute either way.
 */

export const activeAdults = (db: Context<Schema>) =>
  db.users
    .filter(expr((u: User) => u.age >= 18 && u.active))
    .map(expr((u: User) => ({ id: u.id, name: u.name })))
    .toArray();

export const oldestThreeNames = (db: Context<Schema>) =>
  db.users
    .orderByDescending(expr((u: User) => u.age))
    .thenBy(expr((u: User) => u.name))
    .take(3)
    .map(expr((u: User) => u.name))
    .toArray();

export const londoners = (db: Context<Schema>) =>
  db.users.count(expr((u: User) => u.city === "London"));

export const namesStartingWith = (db: Context<Schema>, prefix: string) =>
  db.users.filter(expr((u: User) => u.name.startsWith(prefix))).toArray();
