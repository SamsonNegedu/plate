import { useId, useState } from "react";
import { Button } from "@/components/Button";
import { prepareFrontPhoto } from "@/food/ocr/scan";
import { photoCopy } from "@/lib/copy";

interface Props {
  /** The table cropped out of a scanned label, or null when the label was typed. */
  labelPhoto: string | null;
  shareLabel: boolean;
  onShareLabel: (on: boolean) => void;
  frontPhoto: string | null;
  onFrontPhoto: (photo: string | null) => void;
}

/** The two optional photos that travel with a shared product: the cropped nutrition table and the front of the pack. */
export function PhotoShare({
  labelPhoto,
  shareLabel,
  onShareLabel,
  frontPhoto,
  onFrontPhoto,
}: Props) {
  const shareId = useId();
  const frontId = useId();
  const [failed, setFailed] = useState(false);

  const pickFront = async (file: File | undefined) => {
    if (!file) return;
    setFailed(false);
    try {
      onFrontPhoto(await prepareFrontPhoto(file));
    } catch {
      setFailed(true);
    }
  };

  return (
    <section className="grid gap-2.5" aria-label={photoCopy.title}>
      <h3 className="text-body font-semibold">{photoCopy.title}</h3>
      {labelPhoto ? (
        <div className="flex items-start gap-3">
          <img
            src={labelPhoto}
            alt={photoCopy.labelAlt}
            className="h-20 w-20 shrink-0 rounded-ctl border border-line object-cover"
          />
          <label htmlFor={shareId} className="flex min-h-11 items-center gap-2 text-label">
            <input
              id={shareId}
              type="checkbox"
              className="size-5 accent-accent"
              checked={shareLabel}
              onChange={(e) => onShareLabel(e.target.checked)}
            />
            {photoCopy.shareLabel}
          </label>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        {frontPhoto ? (
          <img
            src={frontPhoto}
            alt={photoCopy.frontAlt}
            className="h-20 w-20 shrink-0 rounded-ctl border border-line object-cover"
          />
        ) : null}
        <div className="grid flex-1 gap-1.5">
          <label
            htmlFor={frontId}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-ctl border border-line bg-surface px-4 text-center text-body leading-heading font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
          >
            {frontPhoto ? photoCopy.changeFront : photoCopy.addFront}
            <input
              id={frontId}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void pickFront(file);
              }}
            />
          </label>
          {frontPhoto ? (
            <Button variant="ghost" onClick={() => onFrontPhoto(null)}>
              {photoCopy.removeFront}
            </Button>
          ) : null}
        </div>
      </div>
      {failed ? (
        <p className="text-meta text-red" role="alert">
          {photoCopy.failed}
        </p>
      ) : null}
      <p className="text-meta text-ink-2">{photoCopy.note}</p>
    </section>
  );
}
