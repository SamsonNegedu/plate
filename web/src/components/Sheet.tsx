import * as Dialog from "@radix-ui/react-dialog";
import {
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";

/** A downward drag closes the sheet after a clear pull or a quick flick (at least 500 px per second). */
export function shouldDismissSheet(dy: number, elapsedMs: number): boolean {
  if (dy <= 0) return false;
  return dy >= 96 || (dy >= 24 && dy / Math.max(1, elapsedMs) >= 0.5);
}

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

/**
 * Brings a field that just took focus to the middle of the sheet's scrolling body. The keyboard rises about a quarter of a
 * second later and shrinks the sheet; without this the field can end up under it or under the sticky footer.
 */
function keepFocusedFieldInView(e: FocusEvent<HTMLDivElement>) {
  const el = e.target;
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
  )
    return;
  if (el.type === "file" || el.type === "checkbox") return;
  window.setTimeout(() => {
    // The sheet may have closed meanwhile, and jsdom has no scrollIntoView.
    if (el.isConnected) el.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, 300);
}

/** A bottom sheet. Radix gives the focus trap, Escape, and focus return to the trigger. */
export function Sheet({ title, description, onClose, children, footer, pinned, tall }: Props) {
  const area = useVisibleArea();
  const vars = area
    ? ({ "--vv-h": `${area.height}px`, "--vv-bottom": `${area.bottom}px` } as CSSProperties)
    : undefined;
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragStart.current = { y: e.clientY, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (start) setDrag(Math.max(0, e.clientY - start.y));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dy = Math.max(0, e.clientY - start.y);
    const elapsed = performance.now() - start.t;
    dragStart.current = null;
    setDrag(0);
    if (shouldDismissSheet(dy, elapsed)) onClose();
  };
  const cancelDrag = () => {
    dragStart.current = null;
    setDrag(0);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-[var(--vv-bottom,0px)] z-[41] mx-auto flex max-h-[min(92dvh,calc(var(--vv-h,100dvh)-8px))] w-full max-w-[560px] animate-rise flex-col rounded-t-card border border-b-0 border-line bg-surface shadow-[0_-8px_30px_-18px_rgba(0,0,0,0.35)] transition-transform duration-200 outline-none focus:outline-none motion-reduce:animate-none motion-reduce:transition-none",
            tall && "h-[min(92dvh,calc(var(--vv-h,100dvh)-8px))]",
          )}
          style={{
            ...vars,
            ...(drag ? { transform: `translateY(${drag}px)`, transition: "none" } : {}),
          }}
        >
          <div
            className="shrink-0 touch-none select-none"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={cancelDrag}
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
          </div>
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
            onFocus={keepFocusedFieldInView}
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
