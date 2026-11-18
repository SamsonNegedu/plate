import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DatabaseProvider } from "@/db/context";
import { PlateDB } from "@/db/schema";
import type { Food } from "@/db/types";
import { useUi } from "@/lib/ui";
import { ManualFoodSheet } from "./ManualFoodSheet";
import { ProductSheet } from "./ProductSheet";
import { QuickAddSheet } from "./QuickAddSheet";

let db: PlateDB;
let n = 0;

beforeEach(() => {
  db = new PlateDB(`log-test-${++n}`);
  useUi.setState({ sheets: [], toasts: [] });
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  db.close();
  await db.delete();
});

const nutella: Food = {
  id: "0190a1b2-0000-7000-8000-000000000001",
  barcode: "80177173",
  name: "Nutella",
  brand: "Ferrero",
  quantity: "400 g",
  servingSize: "15 g",
  servingGrams: 15,
  kcal: 539,
  protein: 6.3,
  carbs: null,
  fat: 30.9,
  sugar: null,
  satfat: 10.6,
  fiber: null,
  salt: 0.107,
  nutriscore: "e",
  source: "catalog",
  sourceId: "80177173",
  sourceCheckedAt: null,
  stale: false,
  imagePath: null,
  ingredients: "",
  allergens: "",
  searchName: "nutella ferrero",
  updatedAt: "",
  deletedAt: null,
  serverSeq: 0,
};

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <DatabaseProvider db={db}>{ui}</DatabaseProvider>
    </MemoryRouter>,
  );

describe("product sheet", () => {
  test("shows the per-100 g label with a dash for every missing value, never a zero", () => {
    wrap(<ProductSheet food={nutella} meal="lunch" date="2026-11-13" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("539 kcal")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Carbohydrate/ })).toHaveTextContent("—");
    expect(within(table).getByRole("row", { name: /sugars/ })).toHaveTextContent("—");
    expect(within(table).getByRole("row", { name: /Fat/ })).toHaveTextContent("30.9 g");
    expect(screen.getByText("Nutri-Score")).toBeInTheDocument();
  });

  test("starts at one portion when a serving weight exists and shows the grams", () => {
    wrap(<ProductSheet food={nutella} meal="lunch" date="2026-11-13" />);
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("1");
    expect(screen.getByText(/1 portion · 15 g/)).toBeInTheDocument();
    expect(screen.getByText("81")).toBeInTheDocument(); // 539 * 15 / 100 = 80.85
    expect(screen.getByRole("button", { name: "Add to lunch" })).toBeEnabled();
  });

  test("a food without a serving weight has no portion unit and starts at 100 g", () => {
    wrap(
      <ProductSheet
        food={{ ...nutella, servingGrams: null, servingSize: "" }}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(screen.queryByRole("button", { name: "Portion" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("100");
  });

  test("ml is offered only for liquids", () => {
    wrap(
      <ProductSheet
        food={{ ...nutella, quantity: "1 l", servingGrams: null }}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(screen.getByRole("button", { name: "ml" })).toBeInTheDocument();
  });

  test("accepts a decimal comma and recomputes", async () => {
    const user = userEvent.setup();
    wrap(<ProductSheet food={{ ...nutella, servingGrams: null }} meal="lunch" date="2026-11-13" />);
    const amount = screen.getByRole("textbox", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "37,5");
    expect(screen.getByText("202")).toBeInTheDocument(); // 539 * 37.5 / 100 = 202.1
  });

  test.each([
    ["0", /above zero/],
    ["", /Enter an amount/],
    ["abc", /Enter an amount/],
    ["6000", /more than 5000/],
  ])("blocks %j", async (value, message) => {
    const user = userEvent.setup();
    wrap(<ProductSheet food={{ ...nutella, servingGrams: null }} meal="lunch" date="2026-11-13" />);
    const amount = screen.getByRole("textbox", { name: "Amount" });
    await user.clear(amount);
    if (value) await user.type(amount, value);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Add to lunch" })).toBeDisabled();
  });

  test("adding writes an entry with the nutrition snapshot, remembers the portion, and offers Undo", async () => {
    const user = userEvent.setup();
    wrap(<ProductSheet food={{ ...nutella, servingGrams: null }} meal="lunch" date="2026-11-13" />);
    await user.click(screen.getByRole("button", { name: "Dinner" }));
    const amount = screen.getByRole("textbox", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "30");
    await user.click(screen.getByRole("button", { name: "Add to dinner" }));
    await waitFor(async () => expect(await db.entries.count()).toBe(1));
    const e = (await db.entries.toArray())[0];
    expect(e).toMatchObject({
      name: "Nutella",
      meal: "dinner",
      eatenOn: "2026-11-13",
      amount: 30,
      grams: 30,
      kcal: 539,
      protein: 6.3,
      carbs: null,
      foodId: nutella.id,
      serverSeq: 0,
    });
    expect(await db.foodPrefs.get(nutella.id)).toMatchObject({ unit: "g", amount: 30 });
    expect(await db.outbox.count()).toBe(1);
    const toast = useUi.getState().toasts[0];
    expect(toast?.message).toBe("Added to dinner");
    expect(toast?.action?.label).toBe("Undo");
    await toast?.action?.run();
    expect(await db.entries.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  test("favorite toggles from the sheet", async () => {
    const user = userEvent.setup();
    wrap(<ProductSheet food={nutella} meal="lunch" date="2026-11-13" />);
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(async () => expect(await db.favorites.count()).toBe(1));
    expect(await screen.findByRole("button", { name: "Remove from favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("quick add", () => {
  test("creates the synthetic 100 g entry: one portion whose per-100 values equal the totals", async () => {
    const user = userEvent.setup();
    wrap(<QuickAddSheet meal="lunch" date="2026-11-13" />);
    await user.type(screen.getByRole("textbox", { name: "Name (optional)" }), "Canteen");
    await user.type(screen.getByRole("textbox", { name: "Calories" }), "640,5");
    await user.type(screen.getByRole("textbox", { name: "Protein (optional)" }), "30");
    await user.click(screen.getByRole("button", { name: "Add to lunch" }));
    await waitFor(async () => expect(await db.entries.count()).toBe(1));
    expect((await db.entries.toArray())[0]).toMatchObject({
      name: "Canteen",
      foodId: null,
      amount: 1,
      unit: "serving",
      grams: 100,
      kcal: 640.5,
      protein: 30,
      carbs: null,
      fat: null,
    });
  });

  test.each([["0"], ["5001"], [""], ["abc"]])("rejects %j calories", async (value) => {
    const user = userEvent.setup();
    wrap(<QuickAddSheet meal="lunch" date="2026-11-13" />);
    if (value) await user.type(screen.getByRole("textbox", { name: "Calories" }), value);
    await user.click(screen.getByRole("button", { name: "Add to lunch" }));
    expect(await screen.findByText(/calories/i, { selector: "p" })).toBeInTheDocument();
    expect(await db.entries.count()).toBe(0);
  });
});

describe("manual food", () => {
  test("a not-loggable product gets the explanation and never a zero-calorie Add", () => {
    wrap(
      <ManualFoodSheet
        meal="lunch"
        date="2026-11-13"
        barcode="4000000000011"
        name="Mystery bar"
        notLoggable
      />,
    );
    expect(screen.getByText(/no calorie data/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Mystery bar");
    expect(screen.getByRole("textbox", { name: "Barcode" })).toHaveValue("4000000000011");
    expect(screen.queryByRole("button", { name: /^Add to/ })).toBeNull();
  });

  test("calories are required and blank nutrients stay null", async () => {
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode={null} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Hausbrot");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter calories per 100 g/)).toBeInTheDocument();
    expect(await db.foods.count()).toBe(0);
    await user.type(screen.getByRole("textbox", { name: "Calories" }), "245");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await db.foods.count()).toBe(1));
    expect((await db.foods.toArray())[0]).toMatchObject({
      name: "Hausbrot",
      kcal: 245,
      protein: null,
      carbs: null,
      fat: null,
      source: "user",
      barcode: null,
    });
  });

  test("a bad barcode is blocked", async () => {
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode="123" />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "X");
    await user.type(screen.getByRole("textbox", { name: "Calories" }), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/6 to 14 digits/)).toBeInTheDocument();
  });

  test("correcting a food keeps its barcode read-only", () => {
    wrap(
      <ManualFoodSheet meal="lunch" date="2026-11-13" barcode={nutella.barcode} food={nutella} />,
    );
    expect(screen.getByRole("textbox", { name: "Barcode" })).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Calories" })).toHaveValue("539");
  });
});
