import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { scanLabel, type ScanResult, warmUpIfCached } from "@/food/ocr/scan";
import { cn } from "@/lib/cn";
import { labelCopy } from "@/lib/copy";

interface Props {
  onResult: (result: ScanResult) => void;
  /** The main action of the sheet, so it looks like one. */
  primary?: boolean;
  /** Replaces the default label, for a second scan. */
  label?: string;
}

type State = "idle" | "download" | "reading" | "failed";

/**
 * The convenience path: photograph the nutrition table and the values fill in. Typing always works without it. The
 * first scan downloads the reader (about 30 MB) and says so; after that it runs offline. The photo never leaves the device.
 */
export function LabelScan({ onResult, primary, label }: Props) {
  const id = useId();
  const [state, setState] = useState<State>("idle");
  const [cached, setCached] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void warmUpIfCached().then((c) => {
      if (alive) setCached(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setState(cached ? "reading" : "download");
    try {
      const result = await scanLabel(file);
      setCached(true);
      setState("idle");
      onResult(result);
    } catch {
      setState("failed");
    }
  };

  const busy = state === "download" || state === "reading";
  let text: string = label ?? labelCopy.scan;
  if (busy) text = labelCopy.reading;

  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center rounded-ctl border px-4 text-center text-body leading-heading font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
          primary
            ? "border-transparent bg-accent text-on-accent"
            : "border-line bg-surface-2 text-ink",
          busy && "opacity-55",
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="camera" />
          {text}
        </span>
        <input
          id={id}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // choosing the same photo again must still fire
            void onPick(file);
          }}
        />
      </label>
      <p className="min-h-4 text-meta text-ink-2" role="status">
        {state === "download" ? labelCopy.downloading : null}
        {state === "failed" ? labelCopy.failed : null}
        {state === "idle" && cached === false ? labelCopy.firstUse : null}
      </p>
    </div>
  );
}
