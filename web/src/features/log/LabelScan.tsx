import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { cameraAvailable } from "@/food/camera";
import { scanLabel, type ScanResult, warmUpIfCached } from "@/food/ocr/scan";
import { cn } from "@/lib/cn";
import { copy, labelCopy } from "@/lib/copy";
import { constrainedNetwork } from "@/lib/network";
import { useWakeLock } from "@/lib/wakeLock";
import { LabelCamera } from "./LabelCamera";

interface Props {
  onResult: (result: ScanResult) => void;
  /** The main action of the sheet, so the camera button looks like one. */
  primary?: boolean;
  /** After a successful read: the buttons offer another photo. */
  repeat?: boolean;
}

type State = "idle" | "confirm" | "download" | "reading" | "failed";

/** The reader's unpacked size, used only to move the progress bar; the UI never claims a byte total. */
const READER_BYTES = 30_400_000;

/**
 * The convenience path: photograph the nutrition table and the values fill in. Typing always works without it. The
 * first scan downloads the reader (about 30 MB) and says so; after that it runs offline. The photo never leaves the device.
 */
export function LabelScan({ onResult, primary, repeat }: Props) {
  const chooseId = useId();
  const [state, setState] = useState<State>("idle");
  const [cached, setCached] = useState<boolean | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [downloaded, setDownloaded] = useState(0);

  useEffect(() => {
    let alive = true;
    void warmUpIfCached().then((c) => {
      if (alive) setCached(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = async (file: File) => {
    setDownloaded(0);
    setState(cached ? "reading" : "download");
    try {
      const result = await scanLabel(file, setDownloaded);
      setCached(true);
      setState("idle");
      onResult(result);
    } catch {
      setState("failed");
    }
  };

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!cached && constrainedNetwork()) {
      setPending(file);
      setState("confirm");
      return;
    }
    void run(file);
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same photo again must still fire
    onPick(file);
  };

  const busy = state === "download" || state === "reading";
  useWakeLock(busy || cameraOpen || state === "confirm");
  const take = cameraAvailable();
  let status: string | null = null;
  if (state === "reading") status = labelCopy.reading;
  else if (state === "failed") status = labelCopy.failed;
  else if (state === "idle" && cached === false) status = labelCopy.firstUse;

  let view: ReactNode;
  if (cameraOpen) {
    view = (
      <LabelCamera
        onCapture={(file) => {
          setCameraOpen(false);
          onPick(file);
        }}
        onClose={() => setCameraOpen(false)}
      />
    );
  } else if (state === "confirm") {
    view = (
      <div className="grid gap-2 rounded-ctl border border-line bg-surface-2 p-3">
        <p className="text-meta text-ink-2" role="status">
          {labelCopy.confirmDownload}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => {
              setPending(null);
              setState("idle");
            }}
          >
            {copy.common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const file = pending;
              setPending(null);
              if (file) void run(file);
            }}
          >
            {labelCopy.download}
          </Button>
        </div>
      </div>
    );
  } else {
    view = (
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
        {state === "download" ? (
          <div className="grid gap-1">
            <div className="h-1.5 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
              <div
                className="h-full rounded-pill bg-accent transition-[width] motion-reduce:transition-none"
                style={{ width: `${Math.min(95, (downloaded / READER_BYTES) * 100)}%` }}
              />
            </div>
            <p className="min-h-4 text-meta text-ink-2" role="status">
              {downloaded > 0
                ? labelCopy.downloadProgress(downloaded / 1_000_000)
                : labelCopy.downloading}
            </p>
          </div>
        ) : (
          <p className="min-h-4 text-meta text-ink-2" role="status">
            {status}
          </p>
        )}
      </>
    );
  }

  return <div className="grid gap-1.5">{view}</div>;
}
