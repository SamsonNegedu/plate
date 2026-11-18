import { useUi } from "@/lib/ui";

/**
 * Register the service worker in production builds. A new worker waits; the user decides when to reload, and the prompt is
 * held back while the scanner is active, a sheet is open or the outbox has work (see UpdatePrompt).
 */
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const { registerSW } = await import("virtual:pwa-register");
  const update = registerSW({
    onNeedRefresh() {
      useUi.setState({ updateReady: true });
      useUi.setState({ applyUpdate: () => update(true) });
    },
  });
}
