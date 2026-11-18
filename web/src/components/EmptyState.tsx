import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/** One sentence and one action, not decoration. */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  );
}
