import type { BackupSummary } from "./dataTools";

/**
 * The "Your data" panel as two small flows and one message.
 *
 * - restore: choose a backup file, confirm what it holds, then replace everything with it
 * - wipe: ask, type DELETE, then remove the data from the server and this device
 * - problem: the last failure, shown under the buttons
 * Each flow has exactly the data its step needs, so "busy but not confirming" cannot exist.
 */
type RestoreFlow =
  | { step: "idle" }
  | { step: "confirming"; text: string; summary: BackupSummary }
  | { step: "restoring"; text: string; summary: BackupSummary };

type WipeFlow =
  | { step: "idle" }
  | { step: "confirming"; typed: string }
  | { step: "wiping"; typed: string };

interface DataState {
  restore: RestoreFlow;
  wipe: WipeFlow;
  problem: string | null;
}

export type DataEvent =
  | { type: "problemCleared" }
  | { type: "exportFailed"; message: string }
  | { type: "fileChosen" }
  | { type: "fileRead"; text: string; summary: BackupSummary }
  | { type: "fileUnreadable"; message: string }
  | { type: "restoreCancelled" }
  | { type: "restoreStarted" }
  | { type: "restoreFailed"; message: string }
  | { type: "restoreDone" }
  | { type: "wipeOpened" }
  | { type: "wipeTyped"; typed: string }
  | { type: "wipeCancelled" }
  | { type: "wipeStarted" }
  | { type: "wipeFailed"; message: string };

export const initialDataState: DataState = {
  restore: { step: "idle" },
  wipe: { step: "idle" },
  problem: null,
};

export const DELETE_WORD = "DELETE";

export function dataReducer(state: DataState, event: DataEvent): DataState {
  switch (event.type) {
    case "problemCleared":
      return { ...state, problem: null };
    case "exportFailed":
      return { ...state, problem: event.message };
    case "fileChosen":
      return { ...state, restore: { step: "idle" }, problem: null };
    case "fileRead":
      return {
        ...state,
        restore: { step: "confirming", text: event.text, summary: event.summary },
      };
    case "fileUnreadable":
      return { ...state, problem: event.message };
    case "restoreCancelled":
    case "restoreDone":
      return { ...state, restore: { step: "idle" } };
    case "restoreStarted":
      return state.restore.step === "confirming"
        ? { ...state, restore: { ...state.restore, step: "restoring" }, problem: null }
        : state;
    case "restoreFailed":
      return state.restore.step === "restoring"
        ? { ...state, restore: { ...state.restore, step: "confirming" }, problem: event.message }
        : state;
    case "wipeOpened":
      return { ...state, wipe: { step: "confirming", typed: "" } };
    case "wipeTyped":
      return state.wipe.step === "confirming"
        ? { ...state, wipe: { step: "confirming", typed: event.typed } }
        : state;
    case "wipeCancelled":
      return { ...state, wipe: { step: "idle" } };
    case "wipeStarted":
      return state.wipe.step === "confirming" && state.wipe.typed === DELETE_WORD
        ? { ...state, wipe: { step: "wiping", typed: state.wipe.typed }, problem: null }
        : state;
    case "wipeFailed":
      return state.wipe.step === "wiping"
        ? {
            ...state,
            wipe: { step: "confirming", typed: state.wipe.typed },
            problem: event.message,
          }
        : state;
  }
}
