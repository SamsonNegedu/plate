import { useEffect } from "react";
import { useUi } from "@/lib/ui";

/**
 * Ask the browser to keep our data, and surface a full disk instead of dropping writes silently.
 * A write that hits the quota rejects with QuotaExceededError; we catch it at the window and show the banner.
 */
export function useStorageGuards(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void navigator.storage?.persist?.().catch(() => false);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      const name =
        typeof r === "object" && r !== null && "name" in r
          ? String((r as { name: unknown }).name)
          : "";
      if (
        name === "QuotaExceededError" ||
        (typeof r === "object" &&
          r !== null &&
          "inner" in r &&
          String((r as { inner?: { name?: unknown } }).inner?.name) === "QuotaExceededError")
      ) {
        useUi.setState({ quotaExceeded: true });
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [enabled]);
}
