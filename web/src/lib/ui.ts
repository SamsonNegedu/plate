import { create } from "zustand";
import type { Entry, Food, Meal } from "@/db/types";

/** Ephemeral UI state only: which sheet is open and which toasts are showing. Never persisted rows. */
export type Sheet =
  | { kind: "product"; food: Food; meal: Meal; date: string; notice?: string }
  | { kind: "search"; meal: Meal; date: string }
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
    }
  | { kind: "saveMeal"; entries: Entry[] };

export interface ToastItem {
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
