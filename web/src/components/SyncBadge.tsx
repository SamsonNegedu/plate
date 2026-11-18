import { useStore } from "zustand";
import { useSyncStore } from "@/app/sync";
import { cn } from "@/lib/cn";
import { badgeLabel } from "@/sync/status";

type Tone = "warn" | "wait" | "ok";

const dot: Record<Tone, string> = { warn: "bg-red", wait: "bg-amber", ok: "bg-accent" };

function toneOf(status: { state: string; failed: number; pending: number }): Tone {
  if (["error", "auth", "access", "paused"].includes(status.state) || status.failed > 0) {
    return "warn";
  }
  if (status.state === "offline" || status.pending > 0) return "wait";
  return "ok";
}

/** Always says what is true: Offline, Pending N, Syncing, an error, or when it last synced. */
export function SyncBadge() {
  const store = useSyncStore();
  const status = useStore(store);
  const tone = toneOf(status);
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-[7px] rounded-pill border bg-surface px-[11px] text-caption whitespace-nowrap",
        tone === "warn" ? "border-red text-ink" : "border-line text-ink-2",
      )}
      role="status"
    >
      <i className={cn("size-[7px] rounded-full", dot[tone])} aria-hidden="true" />
      {badgeLabel(status)}
    </span>
  );
}
