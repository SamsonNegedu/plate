import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { useSettings } from "@/db/hooks";
import { useScanFeedback } from "@/db/prefs";
import type { ItemInput } from "@/db/savedMeals";
import { draftOf } from "@/features/recipes/draft";
import { createDetector, makeDeduper } from "@/food/barcode";
import { type CameraState, useCamera } from "@/food/camera";
import { digitsOnly, isBarcodeLength, resolveBarcode } from "@/food/lookup";
import { copy } from "@/lib/copy";
import { defaultMeal, isValidDate, logicalDate } from "@/lib/dates";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { beep, haptic } from "./feedback";
import { cameraWanted, initialScanState, scanReducer } from "./scanMachine";

const ERRORS: Partial<Record<CameraState, string>> = {
  denied: copy.scan.denied,
  "no-camera": copy.scan.noCamera,
  busy: copy.scan.busy,
  insecure: copy.scan.insecure,
  unsupported: copy.scan.unsupported,
};

export default function ScanPage() {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useSettings();
  const feedback = useScanFeedback();
  const sheetOpen = useUi((s) => s.sheets.length > 0);
  const [scan, dispatch] = useReducer(scanReducer, initialScanState);
  const detector = scan.detector.kind === "ready" ? scan.detector.detector : null;
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = useRef(makeDeduper());
  // Bumped when a lookup ends without opening a sheet, so the frame loop (which stops on a code) starts again.
  const [resume, setResume] = useState(0);

  const now = useNow();
  const requested = params.get("date");
  const date =
    requested && isValidDate(requested) ? requested : logicalDate(now, settings?.dayStartHour ?? 0);
  const meal = defaultMeal(now);
  // Set when the scanner was opened from the recipe editor: a found food becomes an ingredient instead of an entry.
  const recipeKey = params.get("recipe");
  const recipePath = recipeKey === "new" || !recipeKey ? "/recipes/new" : `/recipes/${recipeKey}`;

  const active = !sheetOpen && cameraWanted(scan);
  const { videoRef, state: cameraState, torchAvailable, torchOn, toggleTorch } = useCamera(active);

  useEffect(() => {
    let alive = true;
    createDetector()
      .then((d) => alive && dispatch({ type: "detectorReady", detector: d }))
      .catch(() => alive && dispatch({ type: "detectorFailed" }));
    return () => {
      alive = false;
    };
  }, []);

  const addToDraft = useCallback(
    (item: ItemInput) => {
      if (!recipeKey) return;
      const d = useUi.getState().recipeDraft;
      ui.setRecipeDraft({
        key: recipeKey,
        name: d?.name ?? "",
        servings: d?.servings ?? "1",
        items: [...(d?.items ?? []), draftOf(item)],
      });
      void navigate(recipePath);
    },
    [ui, recipeKey, recipePath, navigate],
  );

  const handle = useCallback(
    async (raw: string) => {
      const code = digitsOnly(raw);
      dispatch({ type: "lookupStarted" });
      try {
        const r = await resolveBarcode(db, code, { online: navigator.onLine });
        if (recipeKey && r.kind !== "found" && r.kind !== "invalid") {
          ui.toast({
            message:
              "That barcode is not in the food bank. Search for it by name, or add it as a food first.",
          });
          setResume((n) => n + 1);
          return;
        }
        switch (r.kind) {
          case "found":
            ui.open({
              kind: "product",
              food: r.food,
              meal,
              date,
              ...(recipeKey ? { pick: addToDraft } : {}),
            });
            break;
          case "not-found":
            ui.open({ kind: "notFound", meal, date, barcode: code });
            break;
          case "not-loggable":
            ui.open({
              kind: "notFound",
              meal,
              date,
              barcode: code,
              name: r.name,
              notLoggable: true,
            });
            break;
          case "offline":
            ui.toast({ message: copy.scan.offlineMiss });
            ui.open({ kind: "notFound", meal, date, barcode: code });
            break;
          case "unavailable":
            ui.toast({ message: copy.scan.unavailable });
            ui.open({ kind: "notFound", meal, date, barcode: code });
            break;
          case "invalid":
            dispatch({ type: "announced", message: copy.scan.invalid });
            setResume((n) => n + 1);
            break;
        }
      } catch (err) {
        setResume((n) => n + 1);
        throw err;
      } finally {
        dispatch({ type: "lookupEnded" });
      }
    },
    [db, ui, meal, date, recipeKey, addToDraft],
  );

  // Read frames from the video: requestVideoFrameCallback when available, otherwise a throttled animation frame loop.
  useEffect(() => {
    const video = videoRef.current;
    if (cameraState !== "active" || !detector || !video) return;
    let stopped = false;
    let last = 0;
    let handleId = 0;
    const found = (code: string): boolean => {
      // An unsupported code is ignored so the camera keeps looking; the loop only stops for a code worth resolving.
      if (!isBarcodeLength(digitsOnly(code)) || !accept.current(code)) return false;
      stopped = true;
      if (feedback.haptics) haptic();
      if (feedback.sound) beep();
      dispatch({ type: "announced", message: copy.scan.found });
      void handle(code);
      return true;
    };
    const tick = async (now: number) => {
      if (stopped) return;
      if (now - last >= 100 && video.readyState >= 2) {
        last = now;
        try {
          const code = await detector.detect(video);
          if (code && found(code)) return;
        } catch {
          // A frame that cannot be read is skipped.
        }
      }
      schedule();
    };
    const schedule = () => {
      if (stopped) return;
      if ("requestVideoFrameCallback" in video)
        handleId = video.requestVideoFrameCallback((t) => void tick(t));
      else handleId = requestAnimationFrame((t) => void tick(t));
    };
    schedule();
    return () => {
      stopped = true;
      if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handleId);
      else cancelAnimationFrame(handleId);
    };
  }, [cameraState, videoRef, detector, feedback.haptics, feedback.sound, handle, resume]);

  const readPhoto = async (file: File) => {
    if (!detector) {
      dispatch({ type: "announced", message: copy.scan.unsupported });
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const code = await detector.detect(bitmap);
      bitmap.close();
      if (code) {
        if (feedback.haptics) haptic();
        await handle(code);
      } else dispatch({ type: "announced", message: copy.scan.noBarcodeInPhoto });
    } catch {
      dispatch({ type: "announced", message: copy.scan.noBarcodeInPhoto });
    }
  };

  const submitTyped = () => {
    if (scan.input.kind !== "typing") return;
    const code = digitsOnly(scan.input.value);
    if (code.length < 6 || code.length > 14) {
      dispatch({ type: "typedRejected", error: copy.scan.invalid });
      return;
    }
    dispatch({ type: "typingClosed" });
    void handle(code);
  };

  const error =
    ERRORS[cameraState] ?? (scan.detector.kind === "failed" ? copy.scan.unsupported : undefined);
  let status: string = copy.scan.point;
  if (scan.lookup === "running") status = copy.scan.lookingUp;
  else if (cameraState === "starting") status = copy.scan.start;

  return (
    <div className="grid gap-3 pb-2">
      <h1 className="mt-1 text-title font-semibold">
        {recipeKey ? "Scan ingredient" : copy.scan.title}
      </h1>
      <div className="relative grid aspect-[4/5] max-h-[62dvh] place-items-center overflow-hidden rounded-card border border-frame-line bg-frame">
        {error ? (
          <div
            className="absolute inset-0 grid place-items-center bg-surface p-6 text-center"
            role="alert"
          >
            <p className="max-w-[32ch] text-body text-ink">{error}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 size-full object-cover"
              playsInline
              muted
              aria-label="Camera preview"
            />
            <div
              className="relative aspect-[2/1] w-[72%] rounded-ctl border-2 border-dashed border-on-accent opacity-85"
              aria-hidden="true"
            >
              <i className="absolute inset-x-1.5 top-[8%] h-0.5 animate-sweep bg-accent-2 motion-reduce:top-1/2 motion-reduce:animate-none" />
            </div>
            {torchAvailable ? (
              <button
                type="button"
                className="absolute right-3 bottom-3 grid size-12 place-items-center rounded-pill border border-frame-line bg-frame text-on-accent aria-pressed:bg-accent"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label={torchOn ? copy.scan.torchOff : copy.scan.torchOn}
              >
                <Icon name={torchOn ? "torchOff" : "torch"} />
              </button>
            ) : null}
          </>
        )}
      </div>
      <p className="min-h-5.5 text-center text-label text-ink-2" role="status" aria-live="polite">
        {scan.announcement || status}
      </p>

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <Button onClick={() => dispatch({ type: "typingOpened" })}>
          <Icon name="barcode" />
          {copy.scan.typeBarcode}
        </Button>
        <Button onClick={() => fileRef.current?.click()}>{copy.scan.upload}</Button>
        <Button
          onClick={() =>
            ui.open({ kind: "search", meal, date, ...(recipeKey ? { pick: addToDraft } : {}) })
          }
        >
          <Icon name="search" />
          {copy.today.search}
        </Button>
        {recipeKey ? null : (
          <Button onClick={() => ui.open({ kind: "manual", meal, date, barcode: null })}>
            {copy.sheet.addManually}
          </Button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={copy.scan.upload}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void readPhoto(f);
        }}
      />
      <Button variant="ghost" onClick={() => navigate(recipeKey ? recipePath : "/today")}>
        {copy.common.back}
      </Button>

      {scan.input.kind === "typing" ? (
        <Sheet
          title={copy.scan.typeBarcode}
          description="Digits only. Spaces and dashes are ignored."
          onClose={() => dispatch({ type: "typingClosed" })}
          footer={
            <Button variant="primary" block onClick={submitTyped}>
              Look up
            </Button>
          }
        >
          <Field
            label="Barcode"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={scan.input.value}
            error={scan.input.error ?? undefined}
            onChange={(e) => dispatch({ type: "typedChanged", value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitTyped();
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
