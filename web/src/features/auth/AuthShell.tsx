import type { ReactNode } from "react";
import { copy } from "@/lib/copy";

/** The wordmark and tagline above every signed-out screen. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-[max(48px,env(safe-area-inset-top,0px))] pb-12">
      <h1 className="font-display text-display leading-display font-semibold">{copy.app.name}</h1>
      <p className="mt-3 mb-8 text-body text-ink-2">{copy.app.tagline}</p>
      {children}
    </main>
  );
}
