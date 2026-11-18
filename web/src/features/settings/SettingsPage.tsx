import { useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { useDb } from "@/db/context";
import { useSettings } from "@/db/hooks";
import { setScanFeedback, useScanFeedback } from "@/db/prefs";
import { saveSettings } from "@/db/settings";
import type { Theme } from "@/db/types";
import { AboutPanel } from "./AboutPanel";
import { DataPanel } from "./DataPanel";
import { FoodsPanel } from "./FoodsPanel";
import { GoalsForm } from "./GoalsForm";
import styles from "./Settings.module.css";
import { SyncPanel } from "./SyncPanel";

export function SettingsPage() {
  const db = useDb();
  const auth = useAuth();
  const settings = useSettings();
  const feedback = useScanFeedback();
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

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      {auth.email ? <p className={styles.muted}>{`Signed in as ${auth.email}`}</p> : null}

      <section className={styles.section} aria-labelledby="goals-h">
        <h2 id="goals-h">Goals</h2>
        <GoalsForm settings={settings} />
      </section>

      <section className={styles.section} aria-labelledby="look-h">
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
          value={
            feedback.sound && feedback.haptics
              ? "on"
              : !feedback.sound && !feedback.haptics
                ? "off"
                : "some"
          }
          options={[
            { value: "on", label: "Sound and vibration" },
            { value: "off", label: "Silent" },
          ]}
          onChange={(v) => void setScanFeedback(db, { sound: v === "on", haptics: v === "on" })}
        />
      </section>

      <SyncPanel />
      <FoodsPanel dayStartHour={settings.dayStartHour} />
      <DataPanel />
      <AboutPanel />

      <div className={styles.actions}>
        <Button variant="ghost" onClick={() => void auth.logout()}>
          Sign out on this device
        </Button>
      </div>
    </div>
  );
}
