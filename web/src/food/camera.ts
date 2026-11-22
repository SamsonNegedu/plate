import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState =
  | "idle"
  | "starting"
  | "active"
  | "denied"
  | "no-camera"
  | "busy"
  | "insecure"
  | "unsupported";

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/** True when an in-app camera can open, so a camera action can be offered without a later file picker. */
export function cameraAvailable(): boolean {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function classifyCameraError(err: unknown): CameraState {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  )
    return "no-camera";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError")
    return "busy";
  return "unsupported";
}

function unsupportedReason(): CameraState | null {
  if (!window.isSecureContext) return "insecure";
  return typeof navigator.mediaDevices?.getUserMedia === "function" ? null : "unsupported";
}

const IDLE_RELEASE_MS = 30 * 1000;
let shared: MediaStream | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

const isLive = (stream: MediaStream | null): stream is MediaStream =>
  stream !== null && stream.getVideoTracks().some((t) => t.readyState === "live");

function stopShared() {
  for (const t of shared?.getTracks() ?? []) t.stop();
  shared = null;
}

/**
 * One stream for the whole document. An installed iOS app asks for camera permission on every getUserMedia call, so
 * moving between the scanner and the label camera reuses the live stream instead of asking again.
 */
async function acquireStream(): Promise<MediaStream> {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  if (isLive(shared)) return shared;
  shared = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false,
  });
  return shared;
}

/** Lets go of the camera after a short idle, so it is never left on for long behind a closed screen. */
function releaseStream() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(stopShared, IDLE_RELEASE_MS);
}

/**
 * Owns the camera stream. It runs only while `active` is true and the page is visible. On cleanup the preview detaches at once and the
 * stream is released after a short idle, so the camera is not left on, yet coming straight back does not ask again.
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [outcome, setOutcome] = useState<CameraState | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stop = useCallback(() => {
    // The stream outlives this screen, so the torch must not stay lit with it.
    const track = streamRef.current?.getVideoTracks()[0];
    void track
      ?.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
      .catch(() => undefined);
    if (streamRef.current) releaseStream();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const running = active && visible;
  const unsupported = running ? unsupportedReason() : null;

  useEffect(() => {
    if (!running || unsupported) return;
    let cancelled = false;
    void acquireStream()
      .then(async (stream) => {
        if (cancelled) {
          releaseStream();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const caps: TorchCapabilities | undefined =
          track && typeof track.getCapabilities === "function"
            ? track.getCapabilities()
            : undefined;
        setTorchAvailable(Boolean(caps?.torch));
        setOutcome("active");
      })
      .catch((err: unknown) => {
        if (!cancelled) setOutcome(classifyCameraError(err));
      });
    return () => {
      cancelled = true;
      stop();
      setOutcome(null);
      setTorchAvailable(false);
      setTorchOn(false);
    };
  }, [running, unsupported, stop]);

  // Derived, not stored: idle while paused, the support problem if there is one, else how the last start went.
  const state: CameraState = running ? (unsupported ?? outcome ?? "starting") : "idle";

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  /** A focus point in the preview, from 0 to 1 on each axis. Devices without one simply keep their own autofocus. */
  const focusAt = useCallback(async (x: number, y: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet],
      });
    } catch {
      // Not supported here; the camera's own autofocus still runs.
    }
  }, []);

  /** An absolute zoom factor (1 is the widest the camera offers). Ignored where the camera cannot zoom. */
  const zoomTo = useCallback(async (factor: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") return;
    const cape = track.getCapabilities() as unknown as {
      zoom?: { min: number; max: number; step?: number };
    };
    const range = cape.zoom;
    if (!range || typeof range !== "object") return;
    try {
      await track.applyConstraints({
        advanced: [
          {
            zoom: Math.min(range.max, Math.max(range.min, factor)),
          } as unknown as MediaTrackConstraintSet,
        ],
      });
    } catch {
      // Not adjustable on this camera.
    }
  }, []);

  return { videoRef, state, torchAvailable, torchOn, toggleTorch, focusAt, zoomTo };
}
