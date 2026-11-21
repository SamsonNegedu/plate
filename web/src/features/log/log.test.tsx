import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseProvider } from "@/db/context";
import { PlateDB } from "@/db/schema";
import type { Food } from "@/db/types";
import type { ScanResult } from "@/food/ocr/scan";
import { useUi } from "@/lib/ui";
import { ManualFoodSheet } from "./ManualFoodSheet";
import { NotFoundSheet } from "./NotFoundSheet";
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

/**
 * A save finishes by replacing the sheet with the product. A test that ends before that happens leaves the replace to land
 * in the next test's store, so every test that saves waits for it.
 */
const savedAndShown = () =>
  waitFor(() => expect(useUi.getState().sheets.at(-1)).toMatchObject({ kind: "product" }));

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
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "640,5");
    await user.type(screen.getByRole("textbox", { name: "Protein in grams" }), "30");
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
    if (value)
      await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), value);
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
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "245");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await db.foods.count()).toBe(1));
    await savedAndShown();
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
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/6 to 14 digits/)).toBeInTheDocument();
  });

  test("correcting a food keeps its barcode read-only", () => {
    wrap(
      <ManualFoodSheet meal="lunch" date="2026-11-13" barcode={nutella.barcode} food={nutella} />,
    );
    expect(screen.getByRole("textbox", { name: "Barcode" })).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Energy in kilocalories" })).toHaveValue("539");
  });
});

describe("a scanned label", () => {
  const scan: ScanResult = {
    values: { kcal: 192, fat: 12, satfat: 1.9, carbs: 0, protein: 21, salt: 2.8 },
    check: ["satfat"],
    perServing: false,
    region: { x0: 0, y0: 0, x1: 10, y1: 10 },
    metrics: { loadMs: 0, readMs: 1, downloadedBytes: 0, heapBytes: null },
    thumb: "data:image/jpeg;base64,AAAA",
    labelPhoto: "data:image/jpeg;base64,QUJD",
    found: 6,
  };

  afterEach(() => vi.unstubAllGlobals());

  test("fills the table, marks the doubtful value in words, and keeps blanks blank", () => {
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode="4337256560191" scan={scan} />);
    expect(screen.getByRole("textbox", { name: "Energy in kilocalories" })).toHaveValue("192");
    expect(screen.getByRole("textbox", { name: "Protein in grams" })).toHaveValue("21");
    expect(screen.getByRole("textbox", { name: "of which sugars in grams" })).toHaveValue("");
    expect(
      screen.getByRole("textbox", { name: "of which saturates in grams" }),
    ).toHaveAccessibleDescription("Check this value against the label.");
    expect(screen.getByText(/Read from your photo/)).toBeInTheDocument();
  });

  test("shares the cropped table photo and a chosen front photo with the correction", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        if (req.method === "PUT") {
          bodies.push((await req.json()) as Record<string, unknown>);
          return new Response(
            JSON.stringify({
              revision_id: "r",
              status: "accepted",
              origin: "new_product",
              issues: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            id: "0190a1b2-0000-7000-8000-0000000000aa",
            barcode: "4337256560191",
            name: "Räucherlachs",
            kcal: 192,
            source: "catalog",
            community: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode="4337256560191" scan={scan} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Räucherlachs");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await savedAndShown();
    expect(bodies[0]).toMatchObject({ source: "ocr", kcal: 192, label_image: "QUJD" });
    expect(bodies[0]).not.toHaveProperty("front_image");
  });

  test("the table photo is only sent while its box is ticked", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        if (req.method === "PUT") bodies.push((await req.json()) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            revision_id: "r",
            status: "pending",
            origin: "new_product",
            issues: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode="4337256560191" scan={scan} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Räucherlachs");
    await user.click(screen.getByRole("checkbox", { name: /Share the cropped photo/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await savedAndShown();
    expect(bodies[0]).not.toHaveProperty("label_image");
  });
});

describe("not found", () => {
  test("offers the label scan first and typing second, and typing opens the form with the barcode", async () => {
    const user = userEvent.setup();
    wrap(<NotFoundSheet meal="lunch" date="2026-11-13" barcode="4337256560191" />);
    expect(screen.getByText("Barcode 4337256560191")).toBeInTheDocument();
    expect(screen.getByText(/Scan the nutrition label/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Type it in" }));
    expect(useUi.getState().sheets.at(-1)).toMatchObject({
      kind: "manual",
      barcode: "4337256560191",
    });
  });
});

describe("typing the numbers", () => {
  test("a kJ value is converted to the kcal the food is saved with", async () => {
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode={null} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Räucherlachs");
    await user.click(screen.getByRole("button", { name: "kJ" }));
    await user.type(screen.getByRole("textbox", { name: "Energy in kilojoules" }), "801");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await db.foods.count()).toBe(1));
    await savedAndShown();
    expect((await db.foods.toArray())[0]?.kcal).toBe(191.4);
  });

  test("numbers that contradict each other get a hint with the figure they should add up to", async () => {
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode={null} />);
    expect(screen.queryByText(/do not match/)).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "500");
    await user.type(screen.getByRole("textbox", { name: "Fat in grams" }), "12");
    await user.type(screen.getByRole("textbox", { name: "Carbohydrate in grams" }), "0");
    await user.type(screen.getByRole("textbox", { name: "Protein in grams" }), "21");
    expect(await screen.findByText(/do not match.*about 192 kcal/)).toBeInTheDocument();
  });
});

describe("keyboard", () => {
  test("Enter in a number field moves to the next one instead of submitting the form", async () => {
    const user = userEvent.setup();
    wrap(<ManualFoodSheet meal="lunch" date="2026-11-13" barcode={null} />);
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "245{Enter}");
    expect(screen.getByRole("textbox", { name: "Fat in grams" })).toHaveFocus();
    expect(screen.queryByText(/Enter a name/)).toBeNull(); // nothing was submitted
  });
});

describe("quick add shares the capture table", () => {
  test("it has the same kcal and kJ switch and the same hint as a food", async () => {
    const user = userEvent.setup();
    wrap(<QuickAddSheet meal="lunch" date="2026-11-13" />);
    expect(screen.getByRole("button", { name: "kJ" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Energy in kilocalories" }), "500");
    await user.type(screen.getByRole("textbox", { name: "Fat in grams" }), "12");
    await user.type(screen.getByRole("textbox", { name: "Carbohydrate in grams" }), "0");
    await user.type(screen.getByRole("textbox", { name: "Protein in grams" }), "21");
    expect(await screen.findByText(/do not match.*about 192 kcal/)).toBeInTheDocument();
  });
});

describe("the notice after saving", () => {
  test("says what happened and sends nobody to Open Food Facts to add the product again", () => {
    wrap(
      <ProductSheet
        food={nutella}
        meal="lunch"
        date="2026-11-13"
        notice="Saved for everyone who scans this barcode."
      />,
    );
    const note = screen.getByText("Saved for everyone who scans this barcode.");
    expect(within(note).queryByRole("link")).toBeNull();
    expect(screen.queryByRole("link", { name: /Add to Open Food Facts/ })).toBeNull();
  });
});

describe("the product picture", () => {
  const withImage = (imagePath: string | null): Food => ({ ...nutella, imagePath });

  test("shows the picture the food has, as before", () => {
    const { container } = wrap(
      <ProductSheet food={withImage("/api/v1/images/abc")} meal="lunch" date="2026-11-13" />,
    );
    expect(document.querySelector('img[src="/api/v1/images/abc"]')).not.toBeNull();
    expect(container).toBeDefined();
  });

  test("shows a shared front photo the same way", () => {
    wrap(
      <ProductSheet
        food={withImage("/api/v1/images/fact/0190a1b2-0000-7000-8000-0000000000aa/front")}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(document.querySelector('img[src$="/front"]')).not.toBeNull();
  });

  test("falls back to the plain icon when the picture cannot be loaded, instead of a broken image", () => {
    wrap(<ProductSheet food={withImage("/api/v1/images/gone")} meal="lunch" date="2026-11-13" />);
    const img = document.querySelector('img[src="/api/v1/images/gone"]');
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(document.querySelector('img[src="/api/v1/images/gone"]')).toBeNull();
  });

  test("shows the plain icon for a food with no picture", () => {
    wrap(<ProductSheet food={withImage(null)} meal="lunch" date="2026-11-13" />);
    expect(document.querySelector('img[src^="/api/v1/images/"]')).toBeNull();
  });
});

describe("values far outside the category", () => {
  const salmons = {
    name: "smoked salmons",
    ranges: {
      kcal: [123, 180, 244.4],
      fat: [3.3, 11, 17.1],
      protein: [18, 21, 24],
      salt: [1.4, 2.8, 3.6],
    },
  } as const;
  const salmon = (over: Partial<Food>): Food => ({
    ...nutella,
    name: "Räucherlachs",
    brand: "REWE",
    barcode: "4337256560191",
    category: { name: salmons.name, ranges: { ...salmons.ranges } as never },
    ...over,
  });

  test("the wrong salmon gets the warning on its product sheet", () => {
    wrap(
      <ProductSheet
        food={salmon({ kcal: 399, fat: 25, protein: 43.75, carbs: 0, salt: 5.729, satfat: 4.3 })}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(
      screen.getByText(
        /These values look unusual for smoked salmons: energy, fat, protein and salt/,
      ),
    ).toBeInTheDocument();
  });

  test("the same salmon with the label's values has no warning", () => {
    wrap(
      <ProductSheet
        food={salmon({ kcal: 192, fat: 12, protein: 21, carbs: 0, salt: 2.8, satfat: 1.9 })}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(screen.queryByText(/look unusual for smoked salmons/)).toBeNull();
  });

  test("a food with no category is never compared", () => {
    wrap(
      <ProductSheet
        food={salmon({ kcal: 399, fat: 25, protein: 43.75, category: undefined })}
        meal="lunch"
        date="2026-11-13"
      />,
    );
    expect(screen.queryByText(/look unusual for/)).toBeNull();
  });
});
