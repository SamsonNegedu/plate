import { useEffect } from "react";

interface Sentinel {
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

/** Keeps the screen on while a capture or a long download is under way. Silently absent where unsupported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = await api.request("screen");
        if (cancelled) void lock.release();
        else sentinel = lock;
      } catch {
        // The browser refused; the screen may dim.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !sentinel) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
