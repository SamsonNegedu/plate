import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { DayNav } from "@/components/DayNav";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { MealSection } from "@/components/MealSection";
import { SummaryCard } from "@/components/SummaryCard";
import { useDb } from "@/db/context";
import { copyDay, undoAdd } from "@/db/entries";
import { useDay, useSettings } from "@/db/hooks";
import { MEALS, type Meal } from "@/db/types";
import { useLog } from "@/features/log/useLog";
import { copy } from "@/lib/copy";
import { addDays, dayLabel, dayTitle, defaultMeal, isValidDate, logicalDate } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { useFlick } from "@/lib/swipeNav";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { HealthNudge } from "./HealthNudge";
import { InstallNudge } from "./InstallNudge";

export function TodayPage() {
  const params = useParams();
  const now = useNow();
  const settings = useSettings();
  if (!settings) return null;
  const today = logicalDate(now, settings.dayStartHour);
  if (params.date !== undefined && !isValidDate(params.date))
    return <Navigate to="/today" replace />;
  return <Day date={params.date ?? today} today={today} />;
}

function Day({ date, today }: { date: string; today: string }) {
  const db = useDb();
  const navigate = useNavigate();
  const ui = useUi();
  const auth = useAuth();
  const now = useNow();
  const { removeEntry, repeatEntry } = useLog();
  const settings = useSettings();
  const day = useDay(date);
  const yesterday = useDay(addDays(date, -1));
  const meal = defaultMeal(now);
  const go = (d: string) => navigate(d === today ? "/today" : `/today/${d}`);

  const flick = useFlick((dir) => go(addDays(date, -dir)));

  if (!settings || !day) return null;

  const copyYesterday = async (only?: Meal) => {
    const ids = await copyDay(db, addDays(date, -1), date, Date.now(), only);
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
    <div className="touch-pan-y pb-2" {...flick}>
      <DayNav
        title={dayTitle(date, today)}
        label={dayLabel(date)}
        onPrev={() => go(addDays(date, -1))}
        onNext={() => go(addDays(date, 1))}
      />
      <SummaryCard
        totals={day.totals}
        goalKcal={settings.goalKcal}
        targets={{
          protein: settings.proteinG,
          carbs: settings.carbsG,
          fat: settings.fatG,
          fiber: settings.fiberG,
        }}
        onDetails={() => ui.open({ kind: "nutrients", date, scope: "day" })}
      />

      <HealthNudge />

      {auth.codesSaved === false ? (
        <aside
          className="mt-3 grid gap-1 rounded-card border border-amber bg-surface p-3.5"
          aria-label={copy.codes.bannerTitle}
        >
          <p className="text-body font-semibold">{copy.codes.bannerTitle}</p>
          <p className="text-label text-ink-2">{copy.codes.bannerBody}</p>
          <Link
            className="mt-1 inline-flex min-h-11 items-center text-label font-medium text-accent"
            to="/settings"
          >
            {copy.codes.bannerAction}
          </Link>
        </aside>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <Button variant="primary" onClick={() => navigate(`/scan?date=${date}`)}>
          <Icon name="barcode" />
          {copy.today.scan}
        </Button>
        <Button onClick={() => ui.open({ kind: "search", meal, date })}>
          <Icon name="search" />
          {copy.today.search}
        </Button>
      </div>
      <InstallNudge />

      {day.totals.count === 0 && (yesterday?.totals.count ?? 0) > 0 ? (
        <button
          type="button"
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 bg-transparent p-0 text-label font-medium text-accent"
          onClick={() => void copyYesterday()}
        >
          <Icon name="copy" size={16} />
          {copy.today.copyYesterday}
        </button>
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
            onDetails={() => ui.open({ kind: "nutrients", date, scope: m })}
            onOpen={(e) => ui.open({ kind: "entry", entryId: e.id })}
            onSwipe={(e, a) => void (a === "delete" ? removeEntry(e) : repeatEntry(e))}
            extra={
              <>
                {entries.length === 0 && (yesterday?.entries ?? []).some((e) => e.meal === m) ? (
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center gap-1.5 bg-transparent p-0 text-label font-medium text-accent"
                    onClick={() => void copyYesterday(m)}
                  >
                    <Icon name="copy" size={16} />
                    {`Repeat yesterday's ${copy.meals[m].toLowerCase()}`}
                  </button>
                ) : null}
                {entries.length > 0 ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center bg-transparent p-0 text-meta text-ink-2 underline"
                    onClick={() => ui.open({ kind: "saveMeal", entries })}
                  >
                    Save as recipe
                    <span className="sr-only">{` ${formatKcal(entries.reduce((s, e) => s + (e.kcal * e.grams) / 100, 0))} kcal`}</span>
                  </button>
                ) : null}
              </>
            }
          />
        );
      })}
    </div>
  );
}
