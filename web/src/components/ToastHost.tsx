import * as Toast from "@radix-ui/react-toast";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";

/** Toasts are status messages: they never take focus. Undo is a real button. */
export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <Toast.Provider swipeDirection="down" duration={5000} label="Notifications">
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-ctl border py-1.5 pr-1.5 pl-4 data-[state=open]:animate-pop motion-reduce:animate-none",
            t.tone === "error" ? "border-red bg-surface text-ink" : "border-ink bg-ink text-bg",
          )}
          duration={t.persistent ? Infinity : 5000}
          onOpenChange={(open) => !open && dismiss(t.id)}
          type={t.tone === "error" ? "foreground" : "background"}
        >
          <Toast.Description className="flex-1 text-label">{t.message}</Toast.Description>
          {t.action ? (
            <Toast.Action asChild altText={t.action.label}>
              <button
                type="button"
                className="min-h-10 rounded-lg bg-transparent px-3 text-label font-semibold text-inherit underline"
                onClick={() => void t.action?.run()}
              >
                {t.action.label}
              </button>
            </Toast.Action>
          ) : null}
          {t.persistent || t.tone === "error" ? (
            <Toast.Close
              className="size-10 bg-transparent text-glyph text-inherit"
              aria-label={copy.common.close}
            >
              ×
            </Toast.Close>
          ) : null}
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+10px)] z-[60] mx-auto grid max-w-[560px] gap-2 px-4 outline-none" />
    </Toast.Provider>
  );
}
