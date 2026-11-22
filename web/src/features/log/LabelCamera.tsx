import { useState } from "react";
import { Button } from "@/components/Button";
import { useCamera, type CameraState } from "@/food/camera";
import { copy, labelCopy } from "@/lib/copy";

const ERRORS: Partial<Record<CameraState, string>> = {
  denied: labelCopy.cameraDenied,
  "no-camera": labelCopy.cameraMissing,
  busy: labelCopy.cameraBusy,
  insecure: labelCopy.cameraInsecure,
  unsupported: labelCopy.cameraUnsupported,
};

/** A live preview inside the sheet, so taking a label photo never goes through the file picker. */
export function LabelCamera({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const { videoRef, state, torchAvailable, torchOn, toggleTorch } = useCamera(true);
  const [error, setError] = useState<string | null>(null);
  const ready = state === "active";

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(labelCopy.cameraFailed);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "label.jpg", { type: "image/jpeg" }));
        else setError(labelCopy.cameraFailed);
      },
      "image/jpeg",
      0.92,
    );
  };

  const message = ERRORS[state] ?? error ?? null;

  return (
    <div className="grid gap-2">
      <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-ctl border border-line bg-frame">
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          playsInline
          muted
          aria-label="Camera preview"
        />
        {state === "idle" || state === "starting" ? (
          <p className="relative text-meta text-on-accent" role="status">
            {labelCopy.cameraStart}
          </p>
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
      {torchAvailable ? (
        <Button variant="ghost" onClick={() => void toggleTorch()}>
          {torchOn ? copy.scan.torchOff : copy.scan.torchOn}
        </Button>
      ) : null}
      {message ? (
        <p className="text-meta text-ink-2" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
