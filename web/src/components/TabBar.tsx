import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { Icon, type IconName } from "./Icon";

type Tab = { to: string; label: string; icon: IconName };

const left: Tab[] = [
  { to: "/today", label: copy.nav.today, icon: "today" },
  { to: "/recipes", label: copy.nav.recipes, icon: "recipes" },
];
const right: Tab[] = [
  { to: "/health", label: copy.nav.health, icon: "health" },
  { to: "/history", label: copy.nav.history, icon: "history" },
];

function TabLink({ t }: { t: Tab }) {
  return (
    <li className="flex-1">
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
  );
}

export function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-[560px] items-center">
        {left.map((t) => (
          <TabLink key={t.to} t={t} />
        ))}
        <li className="flex flex-1 justify-center">
          <NavLink
            to="/scan"
            aria-label={copy.nav.add}
            className="-mt-5 grid size-14 place-items-center rounded-pill bg-accent text-on-accent no-underline shadow-[0_6px_16px_-6px_rgba(0,0,0,0.45)] active:scale-95 motion-reduce:active:scale-100"
          >
            <Icon name="plus" size={26} />
          </NavLink>
        </li>
        {right.map((t) => (
          <TabLink key={t.to} t={t} />
        ))}
      </ul>
    </nav>
  );
}
