import { create } from "zustand";
import type { ItemInput } from "@/db/savedMeals";
import type { Entry, Food, Meal } from "@/db/types";
import type { DraftItem } from "@/features/recipes/draft";
import type { ScanResult } from "@/food/ocr/scan";

/** Ephemeral UI state only: which sheet is open and which toasts are showing. Never persisted rows. */
/** Called with a food and its amount when a sheet was opened to pick a recipe ingredient instead of logging. */
export type PickIngredient = (item: ItemInput) => void;

export type Sheet =
  | {
      kind: "product";
      food: Food;
      meal: Meal;
      date: string;
      notice?: string;
      pick?: PickIngredient;
    }
  | { kind: "search"; meal: Meal; date: string; pick?: PickIngredient }
  | { kind: "logRecipe"; recipeId: string; meal: Meal; date: string }
  | { kind: "quick"; meal: Meal; date: string }
  | { kind: "entry"; entryId: string }
  | {
      kind: "manual";
      meal: Meal;
      date: string;
      barcode: string | null;
      food?: Food;
      name?: string;
      notLoggable?: boolean;
      logOnSave?: boolean;
      /** A label already read, to fill the form with. */
      scan?: ScanResult;
    }
  | {
      kind: "notFound";
      meal: Meal;
      date: string;
      barcode: string;
      name?: string;
      notLoggable?: boolean;
    }
  | { kind: "saveMeal"; entries: Entry[] }
  | { kind: "nutrients"; date: string; scope: Meal | "day" };

/** A recipe being edited, parked while the scanner finds an ingredient. Unsaved work only: it is gone after a reload. */
interface RecipeDraft {
  /** The recipe id, or "new". */
  key: string;
  name: string;
  servings: string;
  items: DraftItem[];
}

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; run: () => void | Promise<void> };
  tone: "info" | "error";
  persistent: boolean;
}

interface UiState {
  sheets: Sheet[];
  toasts: ToastItem[];
  /** A new service worker is waiting. */
  updateReady: boolean;
  applyUpdate: () => Promise<void>;
  /** A write failed because the device is out of storage. */
  quotaExceeded: boolean;
  /** Foods logged in this session, so the install hint waits until the app has been useful. */
  logCount: number;
  countLog: () => void;
  recipeDraft: RecipeDraft | null;
  setRecipeDraft(d: RecipeDraft | null): void;
  open(sheet: Sheet): void;
  replace(sheet: Sheet): void;
  close(): void;
  closeAll(): void;
  toast(
    t: Omit<ToastItem, "id" | "tone" | "persistent"> & {
      tone?: ToastItem["tone"];
      persistent?: boolean;
    },
  ): void;
  dismiss(id: number): void;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  sheets: [],
  toasts: [],
  updateReady: false,
  applyUpdate: async () => undefined,
  quotaExceeded: false,
  logCount: 0,
  countLog: () => set((s) => ({ logCount: s.logCount + 1 })),
  recipeDraft: null,
  setRecipeDraft: (recipeDraft) => set({ recipeDraft }),
  open: (sheet) => set((s) => ({ sheets: [...s.sheets, sheet] })),
  replace: (sheet) => set((s) => ({ sheets: [...s.sheets.slice(0, -1), sheet] })),
  close: () => set((s) => ({ sheets: s.sheets.slice(0, -1) })),
  closeAll: () => set({ sheets: [] }),
  toast: (t) =>
    set((s) => ({
      toasts: [
        ...s.toasts.slice(-2),
        {
          id: nextToast++,
          tone: t.tone ?? "info",
          persistent: t.persistent ?? false,
          message: t.message,
          ...(t.action ? { action: t.action } : {}),
        },
      ],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const topSheet = (s: UiState): Sheet | undefined => s.sheets.at(-1);
