import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cameraAvailable, useCamera } from "./camera";

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

describe("useCamera", () => {
  const fakeStream = () => {
    const track = {
      readyState: "live",
      stop: vi.fn<() => void>(),
      applyConstraints: vi.fn<() => Promise<void>>(async () => {}),
    };
    return {
      track,
      stream: {
        getTracks: () => [track],
        getVideoTracks: () => [track],
      } as unknown as MediaStream,
    };
  };

  test("coming back to the camera reuses the live stream instead of asking again", async () => {
    secure(true);
    const { stream } = fakeStream();
    const getUserMedia = vi.fn<() => Promise<MediaStream>>(async () => stream);
    devices({ getUserMedia });

    const first = renderHook(() => useCamera(true));
    await waitFor(() => expect(first.result.current.state).toBe("active"));
    first.unmount();

    const second = renderHook(() => useCamera(true));
    await waitFor(() => expect(second.result.current.state).toBe("active"));
    act(() => second.unmount());

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
