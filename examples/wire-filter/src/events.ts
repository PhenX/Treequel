export interface AppEvent {
  id: number;
  type: "signup" | "purchase";
  amount: number;
}

/** The receiving side's store — what a backfill query runs against. */
export const storedEvents: AppEvent[] = [
  { id: 1, type: "signup", amount: 0 },
  { id: 2, type: "purchase", amount: 120 },
  { id: 3, type: "purchase", amount: 60 },
  { id: 4, type: "purchase", amount: 300 },
];
