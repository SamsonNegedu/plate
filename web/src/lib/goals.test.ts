import { describe, expect, test } from "vitest";
import { ageFromBirthYear, restingKcal, suggestGoals, type GoalProfile } from "./goals";
import { withDefaultTargets } from "./macros";

const base: GoalProfile = {
  sex: "male",
  ageYears: 30,
  heightCm: 180,
  weightKg: 80,
  activity: "moderate",
  pace: "0",
};

describe("goal suggestions", () => {
  test("Mifflin-St Jeor resting energy", () => {
    expect(restingKcal(base)).toBe(1780);
    expect(restingKcal({ ...base, sex: "female" })).toBe(1614);
  });

  test("maintenance scales resting energy by activity", () => {
    expect(suggestGoals(base).kcal).toBe(2760);
  });

  test("a pace of -0.5 kg a week removes about 550 kcal a day", () => {
    const s = suggestGoals({ ...base, pace: "-0.5" });
    expect(s.adjustKcal).toBe(-550);
    expect(s.kcal).toBe(2210);
  });

  test("macros add up to the calorie goal within rounding", () => {
    const s = suggestGoals({ ...base, pace: "-0.25" });
    const kcal = s.proteinG * 4 + s.carbsG * 4 + s.fatG * 9;
    expect(Math.abs(kcal - s.kcal)).toBeLessThan(25);
    expect(s.proteinG).toBe(128);
    expect(s.fiberG).toBe(Math.round((s.kcal / 1000) * 14));
  });

  test("protein is lower when maintaining", () => {
    expect(suggestGoals(base).proteinG).toBe(96);
  });

  test("the calorie floor holds and is reported", () => {
    const s = suggestGoals({
      sex: "female",
      ageYears: 55,
      heightCm: 150,
      weightKg: 50,
      activity: "sedentary",
      pace: "-0.5",
    });
    expect(s.kcal).toBe(1200);
    expect(s.raisedToFloor).toBe(true);
  });

  test("age comes from the birth year", () => {
    expect(ageFromBirthYear(1990, new Date(2026, 10, 22))).toBe(36);
  });
});

describe("default targets", () => {
  test("blank targets follow the calorie goal and set ones are kept", () => {
    expect(withDefaultTargets(2000, { protein: 0, carbs: 0, fat: 0, fiber: 0 })).toEqual({
      protein: 100,
      carbs: 250,
      fat: 67,
      fiber: 28,
    });
    expect(withDefaultTargets(2000, { protein: 140, carbs: 0, fat: 0, fiber: 30 })).toMatchObject({
      protein: 140,
      fiber: 30,
    });
  });
});
