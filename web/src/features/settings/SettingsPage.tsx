import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useStore } from "zustand";
import { useAuth } from "@/app/auth";
import { useSyncStore } from "@/app/sync";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { useDb } from "@/db/context";
import { useCustomFoods, useFavoriteFoods, useSavedMeals, useSettings } from "@/db/hooks";
import { setHand, setScanFeedback, useHand, useScanFeedback } from "@/db/prefs";
import { saveSettings } from "@/db/settings";
import type { Theme } from "@/db/types";
import { formatKcal } from "@/lib/numbers";
import { badgeLabel } from "@/sync/status";
import { AboutPanel } from "./AboutPanel";
import { AccountPanel } from "./AccountPanel";
import { DataPanel } from "./DataPanel";
import { FoodsPanel } from "./FoodsPanel";
import { GoalsForm } from "./GoalsForm";
import { SyncPanel } from "./SyncPanel";
import { cls, row } from "./ui";

function feedbackMode(feedback: { sound: boolean; haptics: boolean }): "on" | "off" | "some" {
  if (feedback.sound && feedback.haptics) return "on";
  return feedback.sound || feedback.haptics ? "some" : "off";
}

function Row({
  to,
  title,
  value,
  attention,
}: {
  to: string;
  title: string;
  value?: string | undefined;
  attention?: boolean | undefined;
}) {
  return (
    <li>
      <Link to={to} className={row.link}>
        <span className={row.title}>{title}</span>
        {value ? <span className={attention ? row.attention : row.value}>{value}</span> : null}
        <Icon name="next" size={18} className="shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The Settings home: a few quick toggles and one row per group, each with its state on the right. */
export function SettingsPage() {
  const db = useDb();
  const auth = useAuth();
  const settings = useSettings();
  const feedback = useScanFeedback();
  const hand = useHand();
  const sync = useStore(useSyncStore());
  const favorites = useFavoriteFoods();
  const meals = useSavedMeals();
  const foods = useCustomFoods();
  if (!settings) return null;

  const setTheme = (theme: Theme) =>
    saveSettings(db, {
      goalKcal: settings.goalKcal,
      proteinG: settings.proteinG,
      carbsG: settings.carbsG,
      fatG: settings.fatG,
      dayStartHour: settings.dayStartHour,
      theme,
    });

  const saved = [
    favorites?.length ? plural(favorites.length, "favorite", "favorites") : "",
    meals?.length ? plural(meals.length, "meal", "meals") : "",
    foods?.length ? plural(foods.length, "food", "foods") : "",
  ].filter(Boolean);
  const unsavedCodes = auth.codesSaved === false;
  const syncNeedsYou = ["error", "auth", "access", "paused"].includes(sync.state);

  return (
    <div className={cls.page}>
      <h1 className={cls.title}>Settings</h1>

      <ul className={row.list} aria-label="Settings">
        <Row
          to="/settings/goals"
          title="Goals"
          value={`${formatKcal(settings.goalKcal)} kcal a day`}
        />
        <Row
          to="/settings/account"
          title="Account"
          value={unsavedCodes ? "Save recovery codes" : (auth.username ?? undefined)}
          attention={unsavedCodes}
        />
        <Row
          to="/settings/sync"
          title="Sync"
          value={badgeLabel(sync)}
          attention={syncNeedsYou || sync.conflicts > 0}
        />
        <Row
          to="/settings/foods"
          title="Foods and meals"
          value={saved.length ? saved.join(", ") : undefined}
        />
        <Row to="/health" title="Body and medication" value={settings.medName ?? undefined} />
        <Row to="/settings/data" title="Your data" />
        <Row to="/settings/about" title="About" />
      </ul>

      <section className={cls.section} aria-labelledby="look-h">
        <h2 id="look-h">Appearance</h2>
        <Segmented
          label="Theme"
          value={settings.theme}
          options={[
            { value: "auto", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(t) => void setTheme(t)}
        />
        <Segmented
          label="Scan feedback"
          value={feedbackMode(feedback)}
          options={[
            { value: "on", label: "Sound and vibration" },
            { value: "off", label: "Silent" },
          ]}
          onChange={(v) => void setScanFeedback(db, { sound: v === "on", haptics: v === "on" })}
        />
        <Segmented
          label="Thumb"
          value={hand}
          options={[
            { value: "right", label: "Right hand" },
            { value: "left", label: "Left hand" },
          ]}
          onChange={(v) => void setHand(db, v)}
        />
      </section>

      <button
        type="button"
        className="flex min-h-13 w-full items-center border-y border-line bg-transparent text-left text-body font-medium text-red"
        onClick={() => void auth.logout()}
      >
        Sign out on this device
      </button>
    </div>
  );
}

function SubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={cls.page}>
      <h1 className="sr-only">{title}</h1>
      <Link to="/settings" className={row.back}>
        <Icon name="prev" size={18} />
        Settings
      </Link>
      {children}
    </div>
  );
}

/** One group of settings on its own page. The panel supplies its own heading. */
export function SettingsSection() {
  const { section } = useParams();
  const settings = useSettings();
  if (!settings) return null;
  switch (section) {
    case "goals":
      return (
        <SubPage title="Goals">
          <section className={cls.section} aria-labelledby="goals-h">
            <h2 id="goals-h">Goals</h2>
            <GoalsForm settings={settings} />
          </section>
        </SubPage>
      );
    case "account":
      return (
        <SubPage title="Account">
          <AccountPanel />
        </SubPage>
      );
    case "sync":
      return (
        <SubPage title="Sync">
          <SyncPanel />
        </SubPage>
      );
    case "foods":
      return (
        <SubPage title="Foods and meals">
          <FoodsPanel dayStartHour={settings.dayStartHour} />
        </SubPage>
      );
    case "data":
      return (
        <SubPage title="Your data">
          <DataPanel />
        </SubPage>
      );
    case "about":
      return (
        <SubPage title="About">
          <AboutPanel />
        </SubPage>
      );
    default:
      return <Navigate to="/settings" replace />;
  }
}
