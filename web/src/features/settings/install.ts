import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** Install affordances: Chromium's install prompt, and instructions for iOS. Hidden once the app is installed. */
export function useInstall() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const standalone =
    typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  return {
    canPrompt: event !== null && !standalone,
    ios,
    prompt: async () => {
      await event?.prompt();
      setEvent(null);
    },
  };
}
