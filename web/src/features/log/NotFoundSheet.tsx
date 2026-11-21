import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import type { Meal } from "@/db/types";
import type { ScanResult } from "@/food/ocr/scan";
import { copy, labelCopy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import { LabelScan } from "./LabelScan";

interface Props {
  meal: Meal;
  date: string;
  barcode: string;
  name?: string | undefined;
  notLoggable?: boolean | undefined;
}

/**
 * A scanned barcode no source knows. One clear path: photograph the nutrition table (the form opens filled in) or type it.
 * Whatever is saved here is shared with everyone who scans the same barcode, so the next scan finds it.
 */
export function NotFoundSheet({ meal, date, barcode, name, notLoggable }: Props) {
  const ui = useUi();
  const toForm = (scan?: ScanResult) =>
    ui.replace({
      kind: "manual",
      meal,
      date,
      barcode,
      ...(name ? { name } : {}),
      ...(notLoggable ? { notLoggable } : {}),
      ...(scan ? { scan } : {}),
    });

  return (
    <Sheet
      title={labelCopy.notFoundTitle}
      description={notLoggable ? copy.sheet.notLoggable : labelCopy.notFoundBody}
      onClose={ui.close}
    >
      <div className="grid gap-3">
        <p className="text-label text-ink-2 tabular-nums">{`Barcode ${barcode}`}</p>
        <LabelScan primary onResult={toForm} />
        <Button onClick={() => toForm()}>{labelCopy.type}</Button>
      </div>
    </Sheet>
  );
}
