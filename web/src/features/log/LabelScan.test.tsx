import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CameraState } from "@/food/camera";
import type { ScanResult } from "@/food/ocr/scan";
import { LabelScan } from "./LabelScan";

const ocr = vi.hoisted(() => ({
  scanLabel: vi.fn<(file: File) => Promise<unknown>>(),
  warmUpIfCached: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
}));
const camera = vi.hoisted(() => ({
  cameraAvailable: vi.fn<() => boolean>(),
  useCamera: vi.fn<
    (active: boolean) => {
      videoRef: { current: HTMLVideoElement | null };
      state: CameraState;
      torchAvailable: boolean;
      torchOn: boolean;
      toggleTorch: () => Promise<void>;
    }
  >(),
}));
vi.mock("@/food/ocr/scan", () => ocr);
vi.mock("@/food/camera", () => camera);

const scanned: ScanResult = {
  values: { kcal: 192 },
  check: [],
  perServing: false,
  region: null,
  labelPhoto: null,
  metrics: { loadMs: 0, readMs: 0, downloadedBytes: 0, heapBytes: null },
  thumb: "data:image/jpeg;base64,AAAA",
  found: 1,
};

const photo = () => new File(["x"], "label.jpg", { type: "image/jpeg" });
const onResult = () => vi.fn<(result: ScanResult) => void>();

beforeEach(() => {
  camera.cameraAvailable.mockReturnValue(true);
  camera.useCamera.mockReturnValue({
    videoRef: { current: null },
    state: "active",
    torchAvailable: false,
    torchOn: false,
    toggleTorch: () => Promise.resolve(),
  });
});

afterEach(() => {
  cleanup();
  ocr.scanLabel.mockReset();
});

describe("label scan", () => {
  test("offers the camera and the photo library side by side", () => {
    render(<LabelScan onResult={onResult()} />);
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
    const choose = screen.getByLabelText("Choose photo");
    expect(choose).toHaveAttribute("accept", "image/*");
  });

  test("hides the camera when it cannot open on this device", () => {
    camera.cameraAvailable.mockReturnValue(false);
    render(<LabelScan onResult={onResult()} />);
    expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose photo")).toBeInTheDocument();
  });

  test("reads a photo from the library and reports the values", async () => {
    ocr.scanLabel.mockResolvedValue(scanned);
    const report = onResult();
    render(<LabelScan onResult={report} />);
    const file = photo();
    fireEvent.change(screen.getByLabelText("Choose photo"), { target: { files: [file] } });
    await waitFor(() => expect(report).toHaveBeenCalledWith(scanned));
    expect(ocr.scanLabel).toHaveBeenCalledWith(file);
  });

  test("disables both actions while the reader runs", async () => {
    ocr.scanLabel.mockReturnValue(new Promise(() => {}));
    render(<LabelScan onResult={onResult()} />);
    fireEvent.change(screen.getByLabelText("Choose photo"), { target: { files: [photo()] } });
    await waitFor(() => expect(screen.getByLabelText("Choose photo")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Downloading the label reader|Reading the label/,
    );
  });

  test("opens the camera in place and closes it again", () => {
    render(<LabelScan onResult={onResult()} />);
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(camera.useCamera).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Take the photo" })).toBeEnabled();
    expect(screen.getByText("Fill the frame with the nutrition table.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
  });

  test("says why the camera did not open", () => {
    camera.useCamera.mockReturnValue({
      videoRef: { current: null },
      state: "denied",
      torchAvailable: false,
      torchOn: false,
      toggleTorch: () => Promise.resolve(),
    });
    render(<LabelScan onResult={onResult()} />);
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Camera access is blocked/);
    expect(screen.getByRole("button", { name: "Take the photo" })).toBeDisabled();
  });

  test("offers another photo after a read", () => {
    render(<LabelScan repeat onResult={onResult()} />);
    expect(screen.getByRole("button", { name: "Take another photo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Choose another photo")).toBeInTheDocument();
  });
});
