import { describe, expect, it } from "vitest";
import { TaskLedger } from "./task-ledger";

describe("TaskLedger", () => {
  it("keeps one record per task and stores a successful result", () => {
    const ledger = new TaskLedger<string>();
    const first = ledger.start("task-1");
    const duplicate = ledger.start("task-1");
    expect(duplicate).toBe(first);
    expect(ledger.succeed("task-1", "sent")).toMatchObject({
      state: "succeeded",
      value: "sent",
    });
  });

  it("expires old records", () => {
    let now = 100;
    const ledger = new TaskLedger(10, () => now);
    ledger.start("old");
    now = 111;
    expect(ledger.get("old")).toBeUndefined();
  });

  it("records a failure without throwing", () => {
    const ledger = new TaskLedger();
    expect(ledger.fail("task-2", "not ready")).toMatchObject({
      state: "failed",
      error: "not ready",
    });
  });
});
