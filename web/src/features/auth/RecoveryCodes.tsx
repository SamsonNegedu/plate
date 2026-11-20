import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { api } from "@/lib/api";
import { copy } from "@/lib/copy";
import { download } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";

/** The one-time list of reset codes. The person must say they saved it before moving on. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const text = codes.join("\n");

  // The codes live only on this screen, so leaving before they are saved asks first.
  useEffect(() => {
    if (saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved]);

  const finish = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.POST("/auth/recovery-codes/ack");
      if (!res.response.ok) throw new Error("ack failed");
      onDone();
    } catch {
      setProblem(copy.codes.ackFailed);
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: copy.codes.copied });
    } catch {
      // Clipboard access can be blocked; the codes stay on screen and in the download.
    }
  };

  return (
    <div className="grid gap-3.5 rounded-card border border-line bg-surface p-5">
      <h2 className="text-section font-semibold">{copy.codes.title}</h2>
      <p className="text-body text-ink-2">{copy.codes.body}</p>
      <ul
        aria-label={copy.codes.list}
        className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-ctl border border-line bg-surface-2 p-3 text-body font-medium tracking-wide tabular-nums"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => void copyAll()}>{copy.codes.copy}</Button>
        <Button onClick={() => download("plate-recovery-codes.txt", `${text}\n`, "text/plain")}>
          {copy.codes.download}
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-2.5 text-body">
        <input
          type="checkbox"
          className="size-5 accent-accent"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        {copy.codes.saved}
      </label>
      {problem ? (
        <p className="text-label text-red" role="alert">
          {problem}
        </p>
      ) : null}
      <Button variant="primary" block disabled={!saved} busy={busy} onClick={() => void finish()}>
        {copy.codes.done}
      </Button>
    </div>
  );
}
