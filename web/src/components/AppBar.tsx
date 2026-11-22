import { Link } from "react-router";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";
import { SyncBadge } from "./SyncBadge";

export function AppBar() {
  return (
    <header className="flex min-h-[52px] items-center justify-between pt-[calc(env(safe-area-inset-top,0px)+8px)]">
      <p className="font-display text-wordmark leading-none font-semibold">{copy.app.name}</p>
      <div className="flex items-center gap-1">
        <SyncBadge />
        <Link
          to="/settings"
          className="-mr-2.5 grid size-11 place-items-center text-ink-2"
          aria-label={copy.nav.settings}
        >
          <Icon name="settings" />
        </Link>
      </div>
    </header>
  );
}
