import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** A bottom sheet. Radix gives the focus trap, Escape, and focus return to the trigger. */
export function Sheet({ title, description, onClose, children, footer }: Props) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-[41] mx-auto flex max-h-[92dvh] w-full max-w-[560px] animate-rise flex-col rounded-t-card border border-b-0 border-line bg-surface shadow-[0_-8px_30px_-18px_rgba(0,0,0,0.35)] outline-none focus:outline-none motion-reduce:animate-none"
          aria-describedby={description ? undefined : undefined}
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
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
