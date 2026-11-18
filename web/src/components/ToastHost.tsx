import * as Toast from "@radix-ui/react-toast";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import styles from "./ToastHost.module.css";

/** Toasts are status messages: they never take focus. Undo is a real button. */
export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <Toast.Provider swipeDirection="down" duration={5000} label="Notifications">
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}
          duration={t.persistent ? Infinity : 5000}
          onOpenChange={(open) => !open && dismiss(t.id)}
          type={t.tone === "error" ? "foreground" : "background"}
        >
          <Toast.Description className={styles.msg}>{t.message}</Toast.Description>
          {t.action ? (
            <Toast.Action asChild altText={t.action.label}>
              <button type="button" className={styles.action} onClick={() => void t.action?.run()}>
                {t.action.label}
              </button>
            </Toast.Action>
          ) : null}
          {t.persistent || t.tone === "error" ? (
            <Toast.Close className={styles.dismiss} aria-label={copy.common.close}>
              ×
            </Toast.Close>
          ) : null}
        </Toast.Root>
      ))}
      <Toast.Viewport className={styles.viewport} />
    </Toast.Provider>
  );
}
