import { Component, type ReactNode } from "react";
import { appDb } from "@/db/context";
import { copy } from "@/lib/copy";
import { download, localDump } from "@/lib/diagnostics";

interface State {
  failed: boolean;
}

// React only supports error boundaries as classes; this is the one class in the app.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  private exportData = async () => {
    download(
      `plate-device-${new Date().toISOString().slice(0, 10)}.json`,
      await localDump(appDb()),
    );
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-[560px] px-4 py-16">
        <h1 className="mb-2 text-title font-semibold">{copy.errors.generic}</h1>
        <p className="text-ink-2">
          Your log is stored on this device. Reload to continue, or export a copy first.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-ctl bg-accent px-4 text-body font-medium text-on-accent"
            onClick={() => window.location.reload()}
          >
            {copy.errors.reload}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-ctl border border-line bg-surface px-4 text-body font-medium text-ink"
            onClick={() => void this.exportData()}
          >
            {copy.errors.exportData}
          </button>
        </div>
      </main>
    );
  }
}
