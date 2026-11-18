import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { Icon, type IconName } from "./Icon";

const tabs: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/today", label: copy.nav.today, icon: "today" },
  { to: "/scan", label: copy.nav.scan, icon: "barcode" },
  { to: "/history", label: copy.nav.history, icon: "history" },
  { to: "/settings", label: copy.nav.settings, icon: "settings" },
];

export function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-[560px]">
        {tabs.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-[var(--tabbar-h)] flex-col items-center justify-center gap-[3px] text-micro font-medium no-underline",
                  isActive
                    ? "text-ink before:absolute before:inset-x-[28%] before:-top-px before:h-[3px] before:rounded-b-[3px] before:bg-accent before:content-['']"
                    : "text-ink-2",
                )
              }
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
