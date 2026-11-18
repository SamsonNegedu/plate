import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const minute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, 30_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** The current time, refreshed each minute and when the app returns to the foreground, so "today" rolls over at midnight. */
export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, minute, minute));
}
