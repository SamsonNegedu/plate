import { Navigate, useNavigate, useParams } from "react-router";
import { Button } from "@/components/Button";
import { DayNav } from "@/components/DayNav";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { MealSection } from "@/components/MealSection";
import { SummaryCard } from "@/components/SummaryCard";
import { useDb } from "@/db/context";
import { copyDay, undoAdd } from "@/db/entries";
import { useDay, useRecentFoods, useSettings } from "@/db/hooks";
import { MEALS } from "@/db/types";
import { startingPortion } from "@/features/log/portion";
import { useLog } from "@/features/log/useLog";
import { copy } from "@/lib/copy";
import { addDays, dayLabel, dayTitle, defaultMeal, isValidDate, logicalDate } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { useUi } from "@/lib/ui";
import styles from "./TodayPage.module.css";

export function TodayPage() {
  const params = useParams();
  const settings = useSettings();
  if (!settings) return null;
  const today = logicalDate(new Date(), settings.dayStartHour);
  if (params.date !== undefined && !isValidDate(params.date))
    return <Navigate to="/today" replace />;
  return <Day date={params.date ?? today} today={today} />;
}

function Day({ date, today }: { date: string; today: string }) {
  const db = useDb();
  const navigate = useNavigate();
  const ui = useUi();
  const { logFood } = useLog();
  const settings = useSettings();
  const day = useDay(date);
  const yesterday = useDay(addDays(date, -1));
  const recents = useRecentFoods(3);

  if (!settings || !day) return null;
  const go = (d: string) => navigate(d === today ? "/today" : `/today/${d}`);
  const meal = defaultMeal(new Date());

  const copyYesterday = async () => {
    const ids = await copyDay(db, addDays(date, -1), date);
    if (ids.length === 0) {
      ui.toast({ message: copy.today.nothingToCopy });
      return;
    }
    ui.toast({
      message: `Copied ${ids.length} ${ids.length === 1 ? "entry" : "entries"}`,
      action: {
        label: copy.common.undo,
        run: async () => {
          for (const id of ids) await undoAdd(db, id);
        },
      },
    });
  };

  return (
    <div className={styles.page}>
      <DayNav
        title={dayTitle(date, today)}
        label={dayLabel(date)}
        onPrev={() => go(addDays(date, -1))}
        onNext={() => go(addDays(date, 1))}
      />
      <SummaryCard
        totals={day.totals}
        goalKcal={settings.goalKcal}
        targets={{ protein: settings.proteinG, carbs: settings.carbsG, fat: settings.fatG }}
      />

      <div className={styles.cta}>
        <Button variant="primary" onClick={() => navigate(`/scan?date=${date}`)}>
          <Icon name="barcode" />
          {copy.today.scan}
        </Button>
        <Button onClick={() => ui.open({ kind: "search", meal, date })}>
          <Icon name="search" />
          {copy.today.search}
        </Button>
      </div>

      {(recents ?? []).length > 0 || (yesterday?.totals.count ?? 0) > 0 ? (
        <section className={styles.recent} aria-label={copy.today.recent}>
          {(recents ?? []).map((r) => {
            const p = startingPortion(r.food, r.pref);
            return (
              <button
                key={r.food.id}
                type="button"
                className={styles.chip}
                onClick={() => void logFood(r.food, { ...p, meal, date })}
                aria-label={`Add ${r.food.name} again to ${copy.meals[meal].toLowerCase()}`}
              >
                <Icon name="plus" size={16} />
                <span>{r.food.name}</span>
                <small>to {copy.meals[meal]}</small>
              </button>
            );
          })}
          {(yesterday?.totals.count ?? 0) > 0 ? (
            <button type="button" className={styles.chip} onClick={() => void copyYesterday()}>
              <Icon name="copy" size={16} />
              <span>{copy.today.copyYesterday}</span>
            </button>
          ) : null}
        </section>
      ) : null}

      {day.totals.count === 0 ? (
        <EmptyState title={copy.today.emptyTitle} body={copy.today.emptyBody} />
      ) : null}

      {MEALS.map((m) => {
        const entries = day.entries.filter((e) => e.meal === m);
        return (
          <MealSection
            key={m}
            meal={m}
            entries={entries}
            onAdd={() => ui.open({ kind: "search", meal: m, date })}
            onOpen={(e) => ui.open({ kind: "entry", entryId: e.id })}
            extra={
              entries.length > 0 ? (
                <button
                  type="button"
                  className={styles.saveMeal}
                  onClick={() => ui.open({ kind: "saveMeal", entries })}
                >
                  Save as meal
                  <span className="srOnly">{` ${formatKcal(entries.reduce((s, e) => s + (e.kcal * e.grams) / 100, 0))} kcal`}</span>
                </button>
              ) : null
            }
          />
        );
      })}
    </div>
  );
}
