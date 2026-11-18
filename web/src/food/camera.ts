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

/**
 * Owns the camera stream. It runs only while `active` is true and the page is visible, and always stops its tracks on
 * cleanup, so the camera is never left on behind a sheet or after leaving the route.
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stop = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchAvailable(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    if (!active || !visible) {
      stop();
      setState((s) => (s === "active" || s === "starting" ? "idle" : s));
      return;
    }
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    let cancelled = false;
    setState("starting");
    void navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
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
        setState("active");
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(classifyCameraError(err));
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, visible, stop]);

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

  return { videoRef, state, torchAvailable, torchOn, toggleTorch };
}
