import { describe, expect, test } from "vitest";
import type { Detector } from "@/food/barcode";
import { cameraWanted, initialScanState, type ScanEvent, scanReducer } from "./scanMachine";

const run = (...events: ScanEvent[]) => events.reduce(scanReducer, initialScanState);
const detector: Detector = { kind: "native", detect: () => Promise.resolve(null) };

describe("scan machine", () => {
  test("the camera runs only while it is the input and no lookup is running", () => {
    expect(cameraWanted(initialScanState)).toBe(true);
    expect(cameraWanted(run({ type: "typingOpened" }))).toBe(false);
    expect(cameraWanted(run({ type: "lookupStarted" }))).toBe(false);
    expect(cameraWanted(run({ type: "lookupStarted" }, { type: "lookupEnded" }))).toBe(true);
  });

  test("typing keeps its text and clears the error when the text changes", () => {
    const s = run(
      { type: "typingOpened" },
      { type: "typedChanged", value: "12" },
      { type: "typedRejected", error: "Too short" },
    );
    expect(s.input).toEqual({ kind: "typing", value: "12", error: "Too short" });
    expect(scanReducer(s, { type: "typedChanged", value: "123" }).input).toEqual({
      kind: "typing",
      value: "123",
      error: null,
    });
  });

  test("typed input events are ignored when the sheet is closed", () => {
    const s = run({ type: "typedChanged", value: "9" }, { type: "typedRejected", error: "x" });
    expect(s.input).toEqual({ kind: "camera" });
  });

  test("reopening the sheet starts empty; closing returns to the camera", () => {
    const s = run(
      { type: "typingOpened" },
      { type: "typedChanged", value: "5" },
      { type: "typingClosed" },
      { type: "typingOpened" },
    );
    expect(s.input).toEqual({ kind: "typing", value: "", error: null });
    expect(scanReducer(s, { type: "typingClosed" }).input).toEqual({ kind: "camera" });
  });

  test("a lookup in flight survives opening and closing the sheet", () => {
    const s = run({ type: "lookupStarted" }, { type: "typingOpened" }, { type: "typingClosed" });
    expect(s.lookup).toBe("running");
    expect(cameraWanted(s)).toBe(false);
  });

  test("the detector is loading, then ready or failed, never both", () => {
    expect(initialScanState.detector.kind).toBe("loading");
    expect(run({ type: "detectorReady", detector }).detector).toEqual({ kind: "ready", detector });
    expect(run({ type: "detectorFailed" }).detector.kind).toBe("failed");
  });
});
