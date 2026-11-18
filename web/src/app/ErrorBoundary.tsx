import { Component, type ReactNode } from "react";
import { appDb } from "@/db/context";
import { copy } from "@/lib/copy";
import { download, localDump } from "@/lib/diagnostics";
import styles from "./ErrorBoundary.module.css";

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
      <main className={styles.screen}>
        <h1>{copy.errors.generic}</h1>
        <p>Your log is stored on this device. Reload to continue, or export a copy first.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            {copy.errors.reload}
          </button>
          <button type="button" className={styles.secondary} onClick={() => void this.exportData()}>
            {copy.errors.exportData}
          </button>
        </div>
      </main>
    );
  }
}
