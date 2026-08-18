import { evaluate, makeExpr, partialEval } from "@greffon/core";
import { memoryProvider } from "@greffon/provider-memory";
import { createContext } from "@greffon/query";
import { deserialize, serialize } from "@greffon/tree";
import { describe, expect, it } from "vitest";
import { type AppEvent, storedEvents } from "./events.js";
import { bigPurchases } from "./filters.js";

// The sending side: fold the capture, serialize, stringify. Only JSON crosses.
const wirePayload = (): string => {
  const saved = bigPurchases(100);
  return JSON.stringify(serialize(partialEval({ body: saved.body, scope: saved.scope })));
};

describe("a saved search crosses the wire as JSON", () => {
  it("the receiver evaluates each new event against the received tree", () => {
    const node = deserialize(JSON.parse(wirePayload()));
    const matches = (e: AppEvent): boolean => evaluate(node, { params: { e } }) === true;

    expect(matches({ id: 10, type: "purchase", amount: 250 })).toBe(true);
    expect(matches({ id: 11, type: "purchase", amount: 40 })).toBe(false);
    expect(matches({ id: 12, type: "signup", amount: 0 })).toBe(false);
  });

  it("the same tree backfills as a query over the stored events", async () => {
    const node = deserialize(JSON.parse(wirePayload()));
    const pred = makeExpr<(e: AppEvent) => boolean>(["e"], node);

    const db = createContext<{ events: AppEvent }>(memoryProvider({ events: storedEvents }));
    const hits = await db.events.filter(pred).toArray();

    expect(hits.map((e) => e.id)).toEqual([2, 4]);
  });

  it("a tampered payload is refused, not half-built", () => {
    const payload = JSON.parse(wirePayload()) as { root: unknown };
    payload.root = { kind: "Exec", cmd: "curl evil" };
    expect(() => deserialize(payload)).toThrow(/R1901/);
  });
});
