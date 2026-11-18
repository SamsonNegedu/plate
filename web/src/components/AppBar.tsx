import { copy } from "@/lib/copy";
import { SyncBadge } from "./SyncBadge";

export function AppBar() {
  return (
    <header className="flex min-h-[52px] items-center justify-between pt-[env(safe-area-inset-top,0px)]">
      <p className="font-display text-wordmark leading-none font-semibold">{copy.app.name}</p>
      <SyncBadge />
    </header>
  );
}
