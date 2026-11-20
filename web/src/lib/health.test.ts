import { describe, expect, test } from "vitest";
import type { HealthKind, HealthRecord } from "@/db/types";
import { addDays } from "./dates";
import {
  beforeAfter,
  daysBetween,
  doseChanges,
  dosesOf,
  intakeByCycleDay,
  intakeByMedication,
  intervalOf,
  measureSummaries,
  medicationsIn,
  nextDose,
  type Plan,
  planOf,
  ratingFor,
  supplyLeft,
  weightProgress,
  weightSeries,
} from "./health";

let n = 0;
function rec(
  kind: HealthKind,
  recordedOn: string,
  value: number,
  over: Partial<HealthRecord> = {},
): HealthRecord {
  n++;
  return {
    id: `h${n}`,
    kind,
    recordedOn,
    recordedAt: `${recordedOn}T08:00:00.000Z`,
    value,
    medication: kind === "dose" ? "Mounjaro" : "",
    site: "",
    note: "",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    serverSeq: 0,
    ...over,
  };
}

const START = "2026-10-05";

describe("weight", () => {
  test("a day keeps its last weighing and each point averages the week up to it", () => {
    const series = weightSeries([
      rec("weight", START, 90, { recordedAt: `${START}T07:00:00.000Z` }),
      rec("weight", START, 89, { recordedAt: `${START}T20:00:00.000Z` }),
      rec("weight", addDays(START, 2), 87),
      rec("weight", addDays(START, 20), 80),
      rec("waist", START, 100),
    ]);
    expect(series.map((p) => p.kg)).toEqual([89, 87, 80]);
    expect(series[1]?.avg).toBe(88); // (89 + 87) / 2
    expect(series[2]?.avg).toBe(80); // nothing else within the 7 days before it
  });

  test("progress is measured from the weighing at the start and towards the goal", () => {
    const series = weightSeries([
      rec("weight", "2026-10-01", 100),
      rec("weight", "2026-11-01", 92),
      rec("weight", "2026-11-10", 90),
    ]);
    const p = weightProgress(series, "2026-10-05", 80);
    expect(p?.start.kg).toBe(100);
    expect(p?.changeKg).toBe(-10);
    expect(p?.changePct).toBeCloseTo(-10);
    expect(p?.towardGoal).toBeCloseTo(0.5);
    expect(p?.remainingKg).toBeCloseTo(10);
  });

  test("with no goal there is no progress share, and no weight gives no progress", () => {
    expect(weightProgress([], null, null)).toBeNull();
    const series = weightSeries([rec("weight", START, 90), rec("weight", addDays(START, 7), 89)]);
    expect(weightProgress(series, null, null)?.towardGoal).toBeNull();
  });
});

describe("dose schedule", () => {
  const made = planOf({ medName: "Mounjaro", medIntervalDays: 7, medStartedOn: START });
  if (!made) throw new Error("the test plan is complete, so it must parse");
  const plan: Plan = made;

  test("a plan needs a name, an interval and a start", () => {
    expect(plan).toEqual({ name: "Mounjaro", intervalDays: 7, startedOn: START });
    expect(planOf({ medName: "Mounjaro", medIntervalDays: null, medStartedOn: START })).toBeNull();
  });

  test("before any dose the first one is due on the start date", () => {
    const next = nextDose(plan, [], START);
    expect(next.status).toBe("today");
    expect(nextDose(plan, [], addDays(START, 3)).status).toBe("overdue");
    expect(nextDose(plan, [], addDays(START, -2)).status).toBe("upcoming");
  });

  test("the next dose is the last one plus the interval", () => {
    const doses = [rec("dose", START, 2.5), rec("dose", addDays(START, 7), 2.5)];
    const next = nextDose(plan, doses, addDays(START, 10));
    expect(next.dueOn).toBe(addDays(START, 14));
    expect(next.daysUntil).toBe(4);
    expect(next.status).toBe("upcoming");
    expect(nextDose(plan, doses, addDays(START, 16)).daysUntil).toBe(-2);
  });

  test("only doses of the tracked medication count, matched without regard to case", () => {
    const doses = dosesOf(
      [
        rec("dose", START, 2.5),
        rec("dose", START, 1, { medication: "other" }),
        rec("dose", START, 2.5, { medication: " mounjaro " }),
      ],
      plan,
    );
    expect(doses).toHaveLength(2);
  });

  test("a change in dose is called out", () => {
    const changes = doseChanges([
      rec("dose", START, 2.5),
      rec("dose", addDays(START, 7), 2.5),
      rec("dose", addDays(START, 14), 5),
    ]);
    expect(changes).toEqual([
      { date: START, fromMg: null, toMg: 2.5 },
      { date: addDays(START, 14), fromMg: 2.5, toMg: 5 },
    ]);
  });

  test("supply counts down from when it was set and stops at zero", () => {
    const doses = [rec("dose", START, 2.5), rec("dose", addDays(START, 7), 2.5)];
    expect(supplyLeft(4, `${START}T12:00:00.000Z`, doses)).toBe(3); // only the second dose is after it
    expect(supplyLeft(1, `${START}T00:00:00.000Z`, doses)).toBe(0);
    expect(supplyLeft(null, null, doses)).toBeNull();
  });

  test("calendar days between dates ignore the clock", () => {
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1); // a DST change
    expect(daysBetween("2026-11-20", "2026-11-13")).toBe(-7);
  });
});

describe("ratings", () => {
  test("the last rating of a day wins and a missing one is null", () => {
    const records = [
      rec("appetite", START, 4, { recordedAt: `${START}T07:00:00.000Z` }),
      rec("appetite", START, 2, { recordedAt: `${START}T19:00:00.000Z` }),
    ];
    expect(ratingFor(records, "appetite", START)).toBe(2);
    expect(ratingFor(records, "nausea", START)).toBeNull();
  });
});

describe("insights", () => {
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addDays(START, i);
    const sinceDose = i % 7; // a dose every seventh day, starting on day 0
    return { date, kcal: 1500 + sinceDose * 100, protein: 80, count: 3 };
  });
  const doses = [0, 7, 14, 21].map((i) => rec("dose", addDays(START, i), 2.5));

  test("intake is averaged by days since the last dose", () => {
    const cycle = intakeByCycleDay(days, doses, 7);
    expect(cycle).toHaveLength(7);
    expect(cycle?.[0]).toMatchObject({ day: 0, days: 4, avgKcal: 1500 });
    expect(cycle?.[6]?.avgKcal).toBe(2100);
  });

  test("it stays silent with too little to go on", () => {
    expect(intakeByCycleDay(days.slice(0, 10), doses, 7)).toBeNull();
    expect(intakeByCycleDay(days, doses.slice(0, 1), 7)).toBeNull();
  });

  test("a day before the first dose is not part of any cycle", () => {
    const early = [{ date: addDays(START, -3), kcal: 9999, protein: null, count: 1 }, ...days];
    const cycle = intakeByCycleDay(early, doses, 7);
    expect(cycle?.every((b) => b.avgKcal < 9999)).toBe(true);
  });

  test("before and after compares logged days either side of the start and needs a week of each", () => {
    const span = Array.from({ length: 30 }, (_, i) => ({
      date: addDays("2026-09-20", i),
      kcal: i < 15 ? 2400 : 1700,
      protein: i < 15 ? 70 : 100,
      count: 2,
    }));
    const r = beforeAfter(span, addDays("2026-09-20", 15));
    expect(r?.before.avgKcal).toBe(2400);
    expect(r?.after.avgKcal).toBe(1700);
    expect(r?.after.avgProtein).toBe(100);
    expect(beforeAfter(span.slice(10, 20), addDays("2026-09-20", 15))).toBeNull();
  });

  test("unlogged days do not count as zero", () => {
    const span = Array.from({ length: 30 }, (_, i) => ({
      date: addDays("2026-09-20", i),
      kcal: i % 2 === 0 ? 0 : 2000,
      protein: null,
      count: i % 2 === 0 ? 0 : 2,
    }));
    expect(beforeAfter(span, addDays("2026-09-20", 15))?.before.avgKcal).toBe(2000);
  });
});

describe("body measurements", () => {
  test("each logged measurement is summarised from its first reading to its latest, and unlogged ones are left out", () => {
    const out = measureSummaries([
      rec("waist", "2026-10-01", 96),
      rec("waist", "2026-11-01", 92.5),
      rec("hips", "2026-10-05", 104),
      rec("weight", "2026-10-01", 90),
    ]);
    expect(out.map((m) => m.kind)).toEqual(["waist", "hips"]);
    expect(out[0]?.changeCm).toBe(-3.5);
    expect(out[0]?.count).toBe(2);
    expect(out[1]?.changeCm).toBe(0);
  });

  test("a deleted reading does not count", () => {
    const out = measureSummaries([
      rec("arm", "2026-10-01", 34),
      rec("arm", "2026-11-01", 30, { deletedAt: "x" }),
    ]);
    expect(out[0]?.latest.value).toBe(34);
  });
});

describe("more than one medication", () => {
  const dose = (on: string, med: string, mg = 0.25) => rec("dose", on, mg, { medication: med });

  test("each medication is listed in the order it was first taken, with its own span", () => {
    const meds = medicationsIn([
      dose("2026-10-01", "Wegovy"),
      dose("2026-10-08", "wegovy"),
      dose("2026-11-05", "Mounjaro", 2.5),
    ]);
    expect(meds.map((m) => [m.name, m.firstOn, m.lastOn, m.count])).toEqual([
      ["wegovy", "2026-10-01", "2026-10-08", 2],
      ["Mounjaro", "2026-11-05", "2026-11-05", 1],
    ]);
  });

  test("the interval comes from the product, or else from the person's own usual gap", () => {
    expect(intervalOf(7, [], 1)).toBe(7);
    const own = [
      dose("2026-10-01", "x"),
      dose("2026-10-04", "x"),
      dose("2026-10-07", "x"),
      dose("2026-10-20", "x"),
    ];
    expect(intervalOf(null, own, 7)).toBe(3); // the middle of 3, 3 and 13
    expect(intervalOf(null, [], 7)).toBe(7);
  });

  test("intake is averaged before any dose and under each medication", () => {
    const span = Array.from({ length: 40 }, (_, i) => {
      const date = addDays("2026-10-01", i);
      const stretch = Number(i >= 10) + Number(i >= 25); // 0 before, 1 on the first medication, 2 on the second
      const kcal = [2400, 1800, 1500][stretch] ?? 0;
      return { date, kcal, protein: 100, count: 2 };
    });
    const meds = medicationsIn([dose("2026-10-11", "Wegovy"), dose("2026-10-26", "Mounjaro", 2.5)]);
    const rows = intakeByMedication(span, meds);
    expect(rows?.map((r) => [r.label, r.days, Math.round(r.avgKcal)])).toEqual([
      ["Before", 10, 2400],
      ["Wegovy", 15, 1800],
      ["Mounjaro", 15, 1500],
    ]);
  });

  test("with one medication, or too few logged days in a stretch, there is nothing to compare", () => {
    const span = Array.from({ length: 20 }, (_, i) => ({
      date: addDays("2026-10-01", i),
      kcal: 1800,
      protein: null,
      count: 1,
    }));
    expect(intakeByMedication(span, medicationsIn([dose("2026-10-05", "Wegovy")]))).toBeNull();
    const two = medicationsIn([dose("2026-10-05", "Wegovy"), dose("2026-10-19", "Mounjaro")]);
    const rows = intakeByMedication(span, two);
    expect(rows?.map((r) => r.label)).toEqual(["Before", "Wegovy"]); // Mounjaro has only two logged days
  });
});
