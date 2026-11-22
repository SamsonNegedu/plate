import { useEffect } from "react";
import { useSettings } from "@/db/hooks";
import type { Theme } from "@/db/types";

const KEY = "plate.theme";
// The two page backgrounds from tokens.css, used for the browser's status-bar color.
const BAR: Record<"light" | "dark", string> = { light: "#f4f5ef", dark: "#12150f" };

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  // index.html picks the bar color from the phone's setting; an explicit choice here must win, or the bar clashes.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes("dark") ? "dark" : "light";
    meta.content = BAR[theme === "auto" ? own : theme];
  }
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
