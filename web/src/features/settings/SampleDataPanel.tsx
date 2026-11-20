import { useState } from "react";
import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { useSettings } from "@/db/hooks";
import { loadSampleData, removeSampleData } from "@/db/sampleData";
import { logicalDate } from "@/lib/dates";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { cls } from "./ui";

/** Development builds only: fill the account with recipes and a month of history to try the screens. */
export default function SampleDataPanel() {
  const db = useDb();
  const now = useNow();
  const settings = useSettings();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (!settings) return null;

  const run = async (add: boolean) => {
    setBusy(true);
    try {
      if (add) {
        const r = await loadSampleData(db, logicalDate(now, settings.dayStartHour));
        toast({
          message:
            r.entries === 0
              ? "Sample data is already loaded"
              : `Added ${r.recipes} recipes, ${r.foods} foods, ${r.entries} entries and ${r.health} health records`,
        });
      } else {
        const r = await removeSampleData(db);
        toast({
          message: `Removed ${r.recipes} recipes, ${r.foods} foods, ${r.entries} entries and ${r.health} health records`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cls.section} aria-labelledby="sample-h">
      <h2 id="sample-h">Sample data</h2>
      <p className={cls.muted}>
        Five recipes and about a month of logged days, marked so they can be removed again. They
        sync like real data.
      </p>
      <div className={cls.actions}>
        <Button busy={busy} onClick={() => void run(true)}>
          Load sample data
        </Button>
        <Button busy={busy} onClick={() => void run(false)}>
          Remove sample data
        </Button>
      </div>
    </section>
  );
}
