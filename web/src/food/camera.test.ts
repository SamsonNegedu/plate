import { afterEach, describe, expect, test } from "vitest";
import { cameraAvailable } from "./camera";

const secure = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });

const devices = (value: unknown) =>
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value });

afterEach(() => {
  Reflect.deleteProperty(window, "isSecureContext");
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("cameraAvailable", () => {
  test("needs a secure context", () => {
    devices({ getUserMedia: () => Promise.resolve() });
    secure(false);
    expect(cameraAvailable()).toBe(false);
  });

  test("needs getUserMedia", () => {
    secure(true);
    devices(undefined);
    expect(cameraAvailable()).toBe(false);
  });

  test("is true when both are present", () => {
    secure(true);
    devices({ getUserMedia: () => Promise.resolve() });
    expect(cameraAvailable()).toBe(true);
  });
});
