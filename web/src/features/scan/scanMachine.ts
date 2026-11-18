import type { Detector } from "@/food/barcode";

/**
 * The scan page as two independent regions, so impossible mixes (typing while "scanning", a detector that is both
 * ready and failed) cannot be represented.
 *
 * - input:  the camera is the input, or the barcode sheet is open with its text and validation error
 * - lookup: a barcode is being resolved
 * - detector: the decoder loading, ready, or unavailable
 * The camera runs only while input is the camera and no lookup is running.
 */
export type ScanInput =
  | { kind: "camera" }
  | { kind: "typing"; value: string; error: string | null };

export type DetectorState =
  | { kind: "loading" }
  | { kind: "ready"; detector: Detector }
  | { kind: "failed" };

export interface ScanState {
  input: ScanInput;
  lookup: "idle" | "running";
  detector: DetectorState;
  /** The last thing worth saying to a screen reader. */
  announcement: string;
}

export type ScanEvent =
  | { type: "typingOpened" }
  | { type: "typingClosed" }
  | { type: "typedChanged"; value: string }
  | { type: "typedRejected"; error: string }
  | { type: "lookupStarted" }
  | { type: "lookupEnded" }
  | { type: "detectorReady"; detector: Detector }
  | { type: "detectorFailed" }
  | { type: "announced"; message: string };

export const initialScanState: ScanState = {
  input: { kind: "camera" },
  lookup: "idle",
  detector: { kind: "loading" },
  announcement: "",
};

export function scanReducer(state: ScanState, event: ScanEvent): ScanState {
  switch (event.type) {
    case "typingOpened":
      return { ...state, input: { kind: "typing", value: "", error: null } };
    case "typingClosed":
      return { ...state, input: { kind: "camera" } };
    case "typedChanged":
      return state.input.kind === "typing"
        ? { ...state, input: { kind: "typing", value: event.value, error: null } }
        : state;
    case "typedRejected":
      return state.input.kind === "typing"
        ? { ...state, input: { ...state.input, error: event.error } }
        : state;
    case "lookupStarted":
      return { ...state, lookup: "running" };
    case "lookupEnded":
      return { ...state, lookup: "idle" };
    case "detectorReady":
      return { ...state, detector: { kind: "ready", detector: event.detector } };
    case "detectorFailed":
      return { ...state, detector: { kind: "failed" } };
    case "announced":
      return { ...state, announcement: event.message };
  }
}

/** The camera may run only while it is the input and nothing is being looked up. */
export const cameraWanted = (state: ScanState): boolean =>
  state.input.kind === "camera" && state.lookup === "idle";
