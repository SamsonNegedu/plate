import { useEffect } from "react";
import { useSettings } from "@/db/hooks";
import type { Theme } from "@/db/types";

const KEY = "plate.theme";

/** The only app preference kept in localStorage: it lets the inline script in index.html theme the first paint. */
export function cachedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked; the theme still applies for this session.
  }
}

export function ThemeSync() {
  const settings = useSettings();
  const theme = settings?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
  return null;
}
