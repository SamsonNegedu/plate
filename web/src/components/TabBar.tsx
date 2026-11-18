import { NavLink } from "react-router";
import { copy } from "@/lib/copy";
import { Icon, type IconName } from "./Icon";
import styles from "./TabBar.module.css";

const tabs: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/today", label: copy.nav.today, icon: "today" },
  { to: "/scan", label: copy.nav.scan, icon: "barcode" },
  { to: "/history", label: copy.nav.history, icon: "history" },
  { to: "/settings", label: copy.nav.settings, icon: "settings" },
];

export function TabBar() {
  return (
    <nav className={styles.bar} aria-label="Main">
      <ul>
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ""}`}
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
