import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useScanFeedback } from "@/db/prefs";
import { useCamera, type CameraState } from "@/food/camera";
import { copy, labelCopy } from "@/lib/copy";
import { clampView, cropRegion, type CropView } from "./labelCrop";

const ASPECT = 4 / 3;

const ERRORS: Partial<Record<CameraState, string>> = {
  denied: labelCopy.cameraDenied,
  "no-camera": labelCopy.cameraMissing,
  busy: labelCopy.cameraBusy,
  insecure: labelCopy.cameraInsecure,
  unsupported: labelCopy.cameraUnsupported,
};

interface Shot {
  blob: Blob;
  url: string;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface Gesture {
  mode: "pan" | "pinch";
  view: CropView;
  x: number;
  y: number;
  dist: number;
}

/** A live preview inside the sheet, then a crop step, so taking a label photo never goes through the file picker. */
export function LabelCamera({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const feedback = useScanFeedback();
  const [shot, setShot] = useState<Shot | null>(null);
  const [view, setView] = useState<CropView>({ scale: 1, x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [focusRing, setFocusRing] = useState<Point | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const liveStart = useRef<Point | null>(null);
  const liveZoom = useRef(1);
  const moved = useRef(false);
  const { videoRef, state, torchAvailable, torchOn, toggleTorch, focusAt, zoomTo } = useCamera(
    shot === null,
  );
  const ready = state === "active";

  useEffect(() => {
    if (!focusRing) return;
    const id = window.setTimeout(() => setFocusRing(null), 700);
    return () => window.clearTimeout(id);
  }, [focusRing]);

  useEffect(() => {
    if (!shot) liveZoom.current = 1;
  }, [shot]);

  const box = () => {
    const r = frame.current?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : null;
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // The preview shows a 4:3 cover crop, so capture that same area rather than the whole sensor.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sw = Math.round(vw / vh > ASPECT ? vh * ASPECT : vw);
    const sh = Math.round(vw / vh > ASPECT ? vh : vw / ASPECT);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(labelCopy.cameraFailed);
      return;
    }
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, sw, sh);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError(labelCopy.cameraFailed);
          return;
        }
        if (feedback.haptics && "vibrate" in navigator) navigator.vibrate(30);
        // A data: URL, not a blob: one: a cached app shell can carry an older CSP that blocks blob: images.
        const reader = new FileReader();
        reader.onload = () => {
          setView({ scale: 1, x: 0, y: 0 });
          setShot({ blob, url: String(reader.result), w: sw, h: sh });
        };
        reader.onerror = () => setError(labelCopy.cameraFailed);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.92,
    );
  };

  const retake = () => {
    setShot(null);
    setView({ scale: 1, x: 0, y: 0 });
    setError(null);
    pointers.current.clear();
    gesture.current = null;
  };

  const keep = async () => {
    const current = shot;
    const rect = box();
    if (!current || !rect) return;
    const crop = cropRegion(current.w, current.h, rect.w, rect.h, view);
    const bmp = await createImageBitmap(current.blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(crop.sw));
      canvas.height = Math.max(1, Math.round(crop.sh));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError(labelCopy.cameraFailed);
        return;
      }
      ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) {
        setError(labelCopy.cameraFailed);
        return;
      }
      onCapture(new File([blob], "label.jpg", { type: "image/jpeg" }));
    } finally {
      bmp.close();
    }
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  // Live preview: one finger focuses, two fingers zoom the camera where the device exposes it.
  const liveDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-torch]")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    liveStart.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), zoom: liveZoom.current };
      moved.current = true;
    } else {
      moved.current = false;
    }
  };
  const liveMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size === 2) {
      moved.current = true;
      const factor = p.dist > 0 ? p.zoom * (distance() / p.dist) : p.zoom;
      liveZoom.current = Math.min(4, Math.max(1, factor));
      void zoomTo(liveZoom.current);
    } else if (
      liveStart.current &&
      Math.hypot(e.clientX - liveStart.current.x, e.clientY - liveStart.current.y) > 8
    ) {
      moved.current = true;
    }
  };
  const liveUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const tap = (e: MouseEvent<HTMLButtonElement>) => {
    if (moved.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    // A keyboard activation has no coordinates; focusing the middle is the sensible equivalent.
    const center = e.detail === 0;
    const x = center ? r.width / 2 : e.clientX - r.left;
    const y = center ? r.height / 2 : e.clientY - r.top;
    void focusAt(x / r.width, y / r.height);
    setFocusRing({ x, y });
  };

  // Review: drag to pan the photo, pinch to zoom it behind the fixed frame.
  const reviewDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    const [a, b] = [...pointers.current.values()];
    gesture.current =
      a && b
        ? {
            mode: "pinch",
            view,
            x: 0,
            y: 0,
            dist: Math.hypot(a.x - b.x, a.y - b.y),
          }
        : { mode: "pan", view, x: e.clientX, y: e.clientY, dist: 0 };
  };
  const reviewMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const rect = box();
    const current = shot;
    if (!g || !rect || !current) return;
    if (g.mode === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b || g.dist <= 0) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setView(
        clampView(
          { ...g.view, scale: g.view.scale * (d / g.dist) },
          current.w,
          current.h,
          rect.w,
          rect.h,
        ),
      );
    } else {
      setView(
        clampView(
          { ...g.view, x: g.view.x + (e.clientX - g.x), y: g.view.y + (e.clientY - g.y) },
          current.w,
          current.h,
          rect.w,
          rect.h,
        ),
      );
    }
  };
  const reviewUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const [remaining] = [...pointers.current.values()];
    gesture.current = remaining
      ? { mode: "pan", view, x: remaining.x, y: remaining.y, dist: 0 }
      : null;
  };

  if (shot) {
    return (
      <div className="grid gap-2">
        <div
          ref={frame}
          className="relative aspect-[4/3] w-full touch-none overflow-hidden rounded-ctl border border-line bg-frame"
          onPointerDown={reviewDown}
          onPointerMove={reviewMove}
          onPointerUp={reviewUp}
          onPointerCancel={reviewUp}
        >
          <img
            src={shot.url}
            alt="The label you took"
            draggable={false}
            className="absolute inset-0 size-full object-cover select-none"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-ctl border-2 border-dashed border-on-accent/80"
            aria-hidden="true"
          />
        </div>
        <p className="min-h-4 text-meta text-ink-2">{labelCopy.cropHint}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={retake}>{labelCopy.retake}</Button>
          <Button variant="primary" onClick={() => void keep()}>
            {labelCopy.usePhoto}
          </Button>
        </div>
        {error ? (
          <p className="text-meta text-ink-2" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const message = ERRORS[state] ?? error ?? null;
  return (
    <div className="grid gap-2">
      <div
        className="relative grid aspect-[4/3] w-full touch-none place-items-center overflow-hidden rounded-ctl border border-line bg-frame"
        onPointerDown={liveDown}
        onPointerMove={liveMove}
        onPointerUp={liveUp}
        onPointerCancel={liveUp}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          playsInline
          muted
          aria-label="Camera preview"
        />
        {state === "idle" || state === "starting" ? (
          <p className="relative text-meta text-white" role="status">
            {labelCopy.cameraStart}
          </p>
        ) : null}
        {focusRing ? (
          <span
            className="pointer-events-none absolute size-11 rounded-full border-2 border-on-accent"
            style={{ left: focusRing.x - 22, top: focusRing.y - 22 }}
            aria-hidden="true"
          />
        ) : null}
        <button
          type="button"
          className="absolute inset-0 bg-transparent"
          aria-label={labelCopy.focusHint}
          onClick={tap}
        />
        {torchAvailable ? (
          <button
            type="button"
            data-torch
            className="absolute right-3 bottom-3 grid size-12 place-items-center rounded-pill border border-white/40 bg-frame text-white aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-on-accent"
            onClick={() => void toggleTorch()}
            aria-pressed={torchOn}
            aria-label={torchOn ? copy.scan.torchOff : copy.scan.torchOn}
          >
            <Icon name={torchOn ? "torchOff" : "torch"} />
          </button>
        ) : null}
      </div>
      <p className="min-h-4 text-meta text-ink-2">{ready ? labelCopy.cameraHint : null}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onClose} autoFocus>
          {copy.common.cancel}
        </Button>
        <Button variant="primary" disabled={!ready} onClick={capture}>
          {labelCopy.shutter}
        </Button>
      </div>
      {message ? (
        <p className="text-meta text-ink-2" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
