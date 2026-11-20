import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { cls } from "@/features/log/forms";
import { download } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";
import { shareFileName, type SharedRecipe, toShareJson, toShareText } from "./share";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a copy of a recipe. It goes out as a file and as readable text through the device's own share menu, or is saved or
 * copied. Nothing is uploaded: whoever receives it adds it to their own Plate with Import.
 */
export function ShareSheet({ recipe, onClose }: { recipe: SharedRecipe; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const text = toShareText(recipe);
  const json = toShareJson(recipe);
  const fileName = shareFileName(recipe.name);
  const canShare = typeof navigator.share === "function";

  const share = async () => {
    const file = new File([json], fileName, { type: "application/json" });
    const withFile = navigator.canShare?.({ files: [file] }) === true;
    try {
      await navigator.share({
        title: recipe.name,
        text,
        ...(withFile ? { files: [file] } : {}),
      });
      if (!withFile)
        toast({ message: "Shared the text. Send the file as well so it can be imported." });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        toast({ message: "Could not open the share menu. Save the file instead.", tone: "error" });
    }
  };

  const copied = async (what: string, value: string) =>
    toast(
      (await copy(value))
        ? { message: `Copied the ${what}` }
        : { message: "Could not copy. Save the file instead.", tone: "error" },
    );

  return (
    <Sheet
      title="Share recipe"
      description="This sends a copy. Whoever gets it adds it to their own Plate with Import; nothing is linked or synced."
      onClose={onClose}
      footer={
        <>
          {canShare ? (
            <Button variant="primary" block onClick={() => void share()}>
              Share
            </Button>
          ) : null}
          <Button
            variant={canShare ? "secondary" : "primary"}
            block
            onClick={() => download(fileName, json)}
          >
            Save as file
          </Button>
        </>
      }
    >
      <div className={cls.form}>
        <pre
          className="m-0 rounded-card border border-line bg-surface px-3.5 py-3 font-sans text-meta whitespace-pre-wrap text-ink"
          aria-label="What the recipe says"
        >
          {text}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copied("text", text)}>Copy as text</Button>
          <Button onClick={() => void copied("recipe data", json)}>Copy data to import</Button>
        </div>
        <p className={cls.muted}>
          The data is what Import reads. The text is for a message: it has the amounts but cannot be
          imported.
        </p>
      </div>
    </Sheet>
  );
}
