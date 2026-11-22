import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { cameraAvailable } from "@/food/camera";
import { scanLabel, type ScanResult, warmUpIfCached } from "@/food/ocr/scan";
import { cn } from "@/lib/cn";
import { labelCopy } from "@/lib/copy";
import { LabelCamera } from "./LabelCamera";

interface Props {
  onResult: (result: ScanResult) => void;
  /** The main action of the sheet, so the camera button looks like one. */
  primary?: boolean;
  /** After a successful read: the buttons offer another photo. */
  repeat?: boolean;
}

type State = "idle" | "download" | "reading" | "failed";

/**
 * The convenience path: photograph the nutrition table and the values fill in. Typing always works without it. The
 * first scan downloads the reader (about 30 MB) and says so; after that it runs offline. The photo never leaves the device.
 */
export function LabelScan({ onResult, primary, repeat }: Props) {
  const chooseId = useId();
  const [state, setState] = useState<State>("idle");
  const [cached, setCached] = useState<boolean | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

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

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same photo again must still fire
    void onPick(file);
  };

  const busy = state === "download" || state === "reading";
  const take = cameraAvailable();
  let status: string | null = null;
  if (state === "download") status = labelCopy.downloading;
  else if (state === "reading") status = labelCopy.reading;
  else if (state === "failed") status = labelCopy.failed;
  else if (cached === false) status = labelCopy.firstUse;

  return (
    <div className="grid gap-1.5">
      {cameraOpen ? (
        <LabelCamera
          onCapture={(file) => {
            setCameraOpen(false);
            void onPick(file);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : (
        <>
          <div className={cn("grid gap-2", take && "min-[400px]:grid-cols-2")}>
            {take ? (
              <Button
                variant={primary ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => setCameraOpen(true)}
              >
                <Icon name="camera" />
                {repeat ? labelCopy.takeAnother : labelCopy.takePhoto}
              </Button>
            ) : null}
            <label
              htmlFor={chooseId}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center rounded-ctl border border-line bg-surface-2 px-3 text-center text-body leading-heading font-medium text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                busy && "opacity-55",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Icon name="image" />
                {repeat ? labelCopy.chooseAnother : labelCopy.choosePhoto}
              </span>
              <input
                id={chooseId}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={pick}
              />
            </label>
          </div>
          <p className="min-h-4 text-meta text-ink-2" role="status">
            {status}
          </p>
        </>
      )}
    </div>
  );
}
