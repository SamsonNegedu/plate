import { describe, expect, test } from "vitest";
import { type DataEvent, dataReducer, initialDataState } from "./dataMachine";

const summary = {
  schemaVersion: 1,
  entries: 2,
  foods: 1,
  savedMeals: 0,
  from: "2026-01-01",
  to: "2026-01-02",
};
const run = (...events: DataEvent[]) => events.reduce(dataReducer, initialDataState);

describe("data machine: restore", () => {
  test("choose, confirm, restore, done", () => {
    const confirming = run({ type: "fileChosen" }, { type: "fileRead", text: "{}", summary });
    expect(confirming.restore.step).toBe("confirming");
    const restoring = dataReducer(confirming, { type: "restoreStarted" });
    expect(restoring.restore.step).toBe("restoring");
    expect(dataReducer(restoring, { type: "restoreDone" }).restore.step).toBe("idle");
  });

  test("a failed restore returns to confirming with the file kept and the reason shown", () => {
    const s = run(
      { type: "fileRead", text: "{}", summary },
      { type: "restoreStarted" },
      { type: "restoreFailed", message: "offline" },
    );
    expect(s.restore).toMatchObject({ step: "confirming", text: "{}" });
    expect(s.problem).toBe("offline");
  });

  test("choosing a new file discards the previous one and any message", () => {
    const s = run(
      { type: "fileRead", text: "{}", summary },
      { type: "exportFailed", message: "x" },
      { type: "fileChosen" },
    );
    expect(s.restore.step).toBe("idle");
    expect(s.problem).toBeNull();
  });

  test("restore events that do not fit the step are ignored", () => {
    expect(run({ type: "restoreStarted" }).restore.step).toBe("idle");
    expect(run({ type: "restoreFailed", message: "x" }).problem).toBeNull();
  });
});

describe("data machine: wipe", () => {
  test("the wipe starts only once DELETE is typed", () => {
    const asked = run({ type: "wipeOpened" }, { type: "wipeTyped", typed: "delete" });
    expect(dataReducer(asked, { type: "wipeStarted" }).wipe.step).toBe("confirming");
    const typed = dataReducer(asked, { type: "wipeTyped", typed: "DELETE" });
    expect(dataReducer(typed, { type: "wipeStarted" }).wipe.step).toBe("wiping");
  });

  test("a failed wipe goes back to confirming and keeps what was typed", () => {
    const s = run(
      { type: "wipeOpened" },
      { type: "wipeTyped", typed: "DELETE" },
      { type: "wipeStarted" },
      { type: "wipeFailed", message: "offline" },
    );
    expect(s.wipe).toEqual({ step: "confirming", typed: "DELETE" });
    expect(s.problem).toBe("offline");
  });

  test("cancelling clears what was typed; typing while wiping is ignored", () => {
    const cancelled = run(
      { type: "wipeOpened" },
      { type: "wipeTyped", typed: "DEL" },
      { type: "wipeCancelled" },
    );
    expect(cancelled.wipe.step).toBe("idle");
    const wiping = run(
      { type: "wipeOpened" },
      { type: "wipeTyped", typed: "DELETE" },
      { type: "wipeStarted" },
      { type: "wipeTyped", typed: "x" },
    );
    expect(wiping.wipe).toEqual({ step: "wiping", typed: "DELETE" });
  });
});
