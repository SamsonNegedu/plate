export type Sex = "female" | "male" | "other";
export type Activity = "sedentary" | "light" | "moderate" | "very";
/** Kilograms to change per week; negative loses weight. */
export type Pace = "-0.5" | "-0.25" | "0" | "0.25";

export interface GoalProfile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  pace: Pace;
}

export interface GoalSuggestion {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  maintenanceKcal: number;
  /** Calories added (positive) or removed (negative) per day to reach the pace. */
  adjustKcal: number;
  /** True when the pace was cut back to stay above the calorie floor. */
  raisedToFloor: boolean;
}

const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
};

const KCAL_PER_KG = 7700;
const SEX_OFFSET: Record<Sex, number> = { male: 5, female: -161, other: -78 };
const FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200, other: 1350 };
const FAT_SHARE = 0.275;
const FIBER_G_PER_1000_KCAL = 14;

/** Mifflin-St Jeor resting energy, kcal a day. Uses no ethnicity or BMI term. */
export function restingKcal(
  p: Pick<GoalProfile, "sex" | "ageYears" | "heightCm" | "weightKg">,
): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears + SEX_OFFSET[p.sex];
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** A starting calorie and macro goal. An estimate: the person reviews and adjusts it. */
export function suggestGoals(p: GoalProfile): GoalSuggestion {
  const maintenance = restingKcal(p) * ACTIVITY_FACTOR[p.activity];
  const wanted = (Number(p.pace) * KCAL_PER_KG) / 7;
  const floor = FLOOR_KCAL[p.sex];
  const target = Math.max(maintenance + wanted, floor);
  const kcal = roundTo(target, 10);
  const proteinPerKg = p.pace === "0" ? 1.2 : 1.6;
  const proteinG = Math.round(proteinPerKg * p.weightKg);
  const fatG = Math.round((kcal * FAT_SHARE) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return {
    kcal,
    proteinG,
    carbsG,
    fatG,
    fiberG: Math.round((kcal / 1000) * FIBER_G_PER_1000_KCAL),
    maintenanceKcal: roundTo(maintenance, 10),
    adjustKcal: kcal - roundTo(maintenance, 10),
    raisedToFloor: maintenance + wanted < floor,
  };
}

/** Whole years from a birth year; the exact birthday is not asked for. */
export const ageFromBirthYear = (birthYear: number, now: Date = new Date()): number =>
  now.getFullYear() - birthYear;
