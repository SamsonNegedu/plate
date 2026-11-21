import { topSheet, useUi } from "@/lib/ui";
import { EntryEditSheet } from "./EntryEditSheet";
import { LogRecipeSheet } from "./LogRecipeSheet";
import { ManualFoodSheet } from "./ManualFoodSheet";
import { NotFoundSheet } from "./NotFoundSheet";
import { NutrientsSheet } from "./NutrientsSheet";
import { ProductSheet } from "./ProductSheet";
import { QuickAddSheet } from "./QuickAddSheet";
import { SaveMealSheet } from "./SaveMealSheet";
import { SearchSheet } from "./SearchSheet";

/** Renders the top sheet. Only one dialog is mounted at a time, which keeps focus handling simple. */
export function SheetHost() {
  const sheet = useUi(topSheet);
  const depth = useUi((s) => s.sheets.length);
  if (!sheet) return null;
  const key = `${depth}-${sheet.kind}`;
  switch (sheet.kind) {
    case "product":
      return (
        <ProductSheet
          key={key}
          food={sheet.food}
          meal={sheet.meal}
          date={sheet.date}
          notice={sheet.notice}
          pick={sheet.pick}
        />
      );
    case "search":
      return <SearchSheet key={key} meal={sheet.meal} date={sheet.date} pick={sheet.pick} />;
    case "logRecipe":
      return (
        <LogRecipeSheet key={key} recipeId={sheet.recipeId} meal={sheet.meal} date={sheet.date} />
      );
    case "quick":
      return <QuickAddSheet key={key} meal={sheet.meal} date={sheet.date} />;
    case "entry":
      return <EntryEditSheet key={key} entryId={sheet.entryId} />;
    case "manual":
      return (
        <ManualFoodSheet
          key={key}
          meal={sheet.meal}
          date={sheet.date}
          barcode={sheet.barcode}
          food={sheet.food}
          name={sheet.name}
          notLoggable={sheet.notLoggable}
          scan={sheet.scan}
        />
      );
    case "notFound":
      return (
        <NotFoundSheet
          key={key}
          meal={sheet.meal}
          date={sheet.date}
          barcode={sheet.barcode}
          name={sheet.name}
          notLoggable={sheet.notLoggable}
        />
      );
    case "nutrients":
      return <NutrientsSheet key={key} date={sheet.date} scope={sheet.scope} />;
    case "saveMeal":
      return <SaveMealSheet key={key} entries={sheet.entries} />;
  }
}
