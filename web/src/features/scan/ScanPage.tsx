import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { useSettings } from "@/db/hooks";
import { useScanFeedback } from "@/db/prefs";
import { createDetector, type Detector, makeDeduper } from "@/food/barcode";
import { type CameraState, useCamera } from "@/food/camera";
import { digitsOnly, resolveBarcode } from "@/food/lookup";
import { copy } from "@/lib/copy";
import { defaultMeal, isValidDate, logicalDate } from "@/lib/dates";
import { useUi } from "@/lib/ui";
import { beep, haptic } from "./feedback";
import styles from "./ScanPage.module.css";

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
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [detector, setDetector] = useState<Detector | null>(null);
  const [detectorFailed, setDetectorFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = useRef(makeDeduper());

  const requested = params.get("date");
  const date =
    requested && isValidDate(requested)
      ? requested
      : logicalDate(new Date(), settings?.dayStartHour ?? 0);
  const meal = defaultMeal(new Date());

  const active = !sheetOpen && !typing && !busy;
  const camera = useCamera(active);

  useEffect(() => {
    let alive = true;
    createDetector()
      .then((d) => alive && setDetector(d))
      .catch(() => alive && setDetectorFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const handle = useCallback(
    async (raw: string) => {
      const code = digitsOnly(raw);
      setBusy(true);
      try {
        const r = await resolveBarcode(db, code, { online: navigator.onLine });
        switch (r.kind) {
          case "found":
            ui.open({ kind: "product", food: r.food, meal, date });
            break;
          case "not-found":
            ui.open({ kind: "manual", meal, date, barcode: code });
            break;
          case "not-loggable":
            ui.open({ kind: "manual", meal, date, barcode: code, name: r.name, notLoggable: true });
            break;
          case "offline":
            ui.toast({ message: copy.scan.offlineMiss });
            ui.open({ kind: "manual", meal, date, barcode: code });
            break;
          case "unavailable":
            ui.toast({ message: copy.scan.unavailable });
            ui.open({ kind: "manual", meal, date, barcode: code });
            break;
          case "invalid":
            setAnnounce(copy.scan.invalid);
            setTypedError(copy.scan.invalid);
            break;
        }
      } finally {
        setBusy(false);
      }
    },
    [db, ui, meal, date],
  );

  // Read frames from the video: requestVideoFrameCallback when available, otherwise a throttled animation frame loop.
  useEffect(() => {
    const video = camera.videoRef.current;
    if (camera.state !== "active" || !detector || !video) return;
    let stopped = false;
    let last = 0;
    let handleId = 0;
    const found = (code: string) => {
      if (!accept.current(code)) return;
      stopped = true;
      if (feedback.haptics) haptic();
      if (feedback.sound) beep();
      setAnnounce(copy.scan.found);
      void handle(code);
    };
    const tick = async (now: number) => {
      if (stopped) return;
      if (now - last >= 100 && video.readyState >= 2) {
        last = now;
        try {
          const code = await detector.detect(video);
          if (code) return found(code);
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
  }, [camera.state, camera.videoRef, detector, feedback.haptics, feedback.sound, handle]);

  const readPhoto = async (file: File) => {
    if (!detector) {
      setAnnounce(copy.scan.unsupported);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const code = await detector.detect(bitmap);
      bitmap.close();
      if (code) {
        if (feedback.haptics) haptic();
        await handle(code);
      } else setAnnounce(copy.scan.noBarcodeInPhoto);
    } catch {
      setAnnounce(copy.scan.noBarcodeInPhoto);
    }
  };

  const submitTyped = () => {
    const code = digitsOnly(typed);
    if (code.length < 6 || code.length > 14) {
      setTypedError(copy.scan.invalid);
      return;
    }
    setTyping(false);
    setTyped("");
    void handle(code);
  };

  const error = ERRORS[camera.state] ?? (detectorFailed ? copy.scan.unsupported : undefined);
  const status = busy
    ? copy.scan.lookingUp
    : camera.state === "starting"
      ? copy.scan.start
      : copy.scan.point;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{copy.scan.title}</h1>
      <div className={styles.frame}>
        {error ? (
          <div className={styles.error} role="alert">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <video
              ref={camera.videoRef}
              className={styles.video}
              playsInline
              muted
              aria-label="Camera preview"
            />
            <div className={styles.reticle} aria-hidden="true">
              <i className={styles.line} />
            </div>
            {camera.torchAvailable ? (
              <button
                type="button"
                className={styles.torch}
                onClick={() => void camera.toggleTorch()}
                aria-pressed={camera.torchOn}
                aria-label={camera.torchOn ? copy.scan.torchOff : copy.scan.torchOn}
              >
                <Icon name={camera.torchOn ? "torchOff" : "torch"} />
              </button>
            ) : null}
          </>
        )}
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {announce || status}
      </p>

      <div className={styles.actions}>
        <Button onClick={() => setTyping(true)}>
          <Icon name="barcode" />
          {copy.scan.typeBarcode}
        </Button>
        <Button onClick={() => fileRef.current?.click()}>{copy.scan.upload}</Button>
        <Button onClick={() => ui.open({ kind: "search", meal, date })}>
          <Icon name="search" />
          {copy.today.search}
        </Button>
        <Button onClick={() => ui.open({ kind: "manual", meal, date, barcode: null })}>
          {copy.sheet.addManually}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="srOnly"
        tabIndex={-1}
        aria-label={copy.scan.upload}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void readPhoto(f);
        }}
      />
      <Button variant="ghost" onClick={() => navigate("/today")}>
        {copy.common.back}
      </Button>

      {typing ? (
        <Sheet
          title={copy.scan.typeBarcode}
          description="Digits only. Spaces and dashes are ignored."
          onClose={() => setTyping(false)}
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
            value={typed}
            error={typedError}
            onChange={(e) => {
              setTyped(e.target.value);
              setTypedError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitTyped();
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
