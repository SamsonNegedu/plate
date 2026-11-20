import * as Dialog from "@radix-ui/react-dialog";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Stays in view above the scrolling body, such as a search field, so the keyboard never hides it. */
  pinned?: ReactNode;
  /** Fill the free height instead of fitting the content, so a list that changes as you type does not make the sheet jump. */
  tall?: boolean;
}

/**
 * The part of the screen the keyboard leaves free. iOS keeps the layout viewport full height when the keyboard opens, so a
 * bottom sheet sized in dvh would run behind it and scroll its own top out of view.
 */
function useVisibleArea(): { height: number; bottom: number } | null {
  const [area, setArea] = useState<{ height: number; bottom: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setArea({
        height: vv.height,
        bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
      });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return area;
}

/** A bottom sheet. Radix gives the focus trap, Escape, and focus return to the trigger. */
export function Sheet({ title, description, onClose, children, footer, pinned, tall }: Props) {
  const area = useVisibleArea();
  const vars = area
    ? ({ "--vv-h": `${area.height}px`, "--vv-bottom": `${area.bottom}px` } as CSSProperties)
    : undefined;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-[var(--vv-bottom,0px)] z-[41] mx-auto flex max-h-[min(92dvh,calc(var(--vv-h,100dvh)-8px))] w-full max-w-[560px] animate-rise flex-col rounded-t-card border border-b-0 border-line bg-surface shadow-[0_-8px_30px_-18px_rgba(0,0,0,0.35)] outline-none focus:outline-none motion-reduce:animate-none",
            tall && "h-[min(92dvh,calc(var(--vv-h,100dvh)-8px))]",
          )}
          style={vars}
        >
          <div className="mx-auto mt-2 h-1 w-[38px] rounded-pill bg-line" aria-hidden="true" />
          <header className="flex items-center gap-2 px-4 pt-1.5">
            <Dialog.Title className="flex-1 text-section leading-row font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="-mr-2.5 grid size-11 place-items-center bg-transparent text-ink-2"
              aria-label={copy.common.close}
            >
              <Icon name="close" />
            </Dialog.Close>
          </header>
          {description ? (
            <Dialog.Description className="px-4 text-meta text-ink-2">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          {pinned ? <div className="px-4 pt-3 pb-1">{pinned}</div> : null}
          <div
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 ${pinned ? "pt-1" : "pt-3"}`}
          >
            {children}
          </div>
          {footer ? (
            <footer className="grid gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom,0px))]">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
