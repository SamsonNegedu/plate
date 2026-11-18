import { useEffect } from "react";
import { useLocation } from "react-router";
import { useStore } from "zustand";
import { useUi } from "@/lib/ui";
import { useSyncStore } from "./sync";

/** "New version ready", shown only when reloading is safe: not on the scanner, not behind a sheet, nothing waiting to send. */
export function UpdatePrompt() {
  const ready = useUi((s) => s.updateReady);
  const apply = useUi((s) => s.applyUpdate);
  const sheetOpen = useUi((s) => s.sheets.length > 0);
  const toast = useUi((s) => s.toast);
  const { pathname } = useLocation();
  const pending = useStore(useSyncStore(), (s) => s.pending);
  const safe = ready && !sheetOpen && pathname !== "/scan" && pending === 0;

  useEffect(() => {
    if (safe)
      toast({
        message: "New version ready",
        persistent: true,
        action: { label: "Reload", run: () => apply() },
      });
  }, [safe, apply, toast]);
  return null;
}
