import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { saveMeal } from "@/db/savedMeals";
import { cls } from "@/features/log/forms";
import { formatKcal } from "@/lib/numbers";
import { portionLabel, recipeNutrition } from "@/lib/recipe";
import { useUi } from "@/lib/ui";
import { parseShared, type ParseResult } from "./share";

/** Add a recipe someone sent: choose their file or paste its data. It is checked and previewed before anything is saved. */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const result: ParseResult | null = text.trim() === "" ? null : parseShared(text);
  const recipe = result?.ok ? result.recipe : null;
  const n = recipe ? recipeNutrition(recipe.items, recipe.servings) : null;

  const pick = async (file: File) => {
    try {
      setText(await file.text());
    } catch {
      setText("could not read that file");
    }
  };

  const add = async () => {
    if (!recipe) return;
    setBusy(true);
    try {
      const saved = await saveMeal(db, recipe.name, recipe.servings, recipe.items);
      ui.toast({ message: `Added ${saved.name}` });
      onClose();
      void navigate(`/recipes/${saved.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Import a recipe"
      description="Add a recipe someone shared with you. It becomes your own copy."
      onClose={onClose}
      footer={
        <Button variant="primary" block busy={busy} disabled={!recipe} onClick={() => void add()}>
          Add to my recipes
        </Button>
      }
    >
      <div className={cls.form}>
        <div>
          <Button onClick={() => fileRef.current?.click()}>Choose a file</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Recipe file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="recipe-data" className="text-meta font-medium text-ink-2">
            Or paste the recipe data
          </label>
          <textarea
            id="recipe-data"
            rows={5}
            className="rounded-ctl border border-line bg-surface px-3 py-2 font-sans text-meta"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </div>
        {result && !result.ok ? (
          <p className="text-meta text-red" role="alert">
            {result.error}
          </p>
        ) : null}
        {recipe && n ? (
          <div
            className="grid gap-1 rounded-card border border-line bg-surface px-3.5 py-3"
            role="status"
          >
            <p className="text-body font-semibold">{recipe.name}</p>
            <p className="text-meta text-ink-2">
              {`${recipe.items.length} ${recipe.items.length === 1 ? "ingredient" : "ingredients"} · makes ${portionLabel(recipe.servings)} · ${formatKcal(n.portion.kcal)} kcal a portion`}
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
