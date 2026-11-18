import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";
import styles from "./Sheet.module.css";

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
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.sheet}
          aria-describedby={description ? undefined : undefined}
        >
          <div className={styles.grab} aria-hidden="true" />
          <header className={styles.head}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close className={styles.close} aria-label={copy.common.close}>
              <Icon name="close" />
            </Dialog.Close>
          </header>
          {description ? (
            <Dialog.Description className={styles.desc}>{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="srOnly">{title}</Dialog.Description>
          )}
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
