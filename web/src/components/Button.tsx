import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

interface Props {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  block?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  autoFocus?: boolean;
  form?: ButtonHTMLAttributes<HTMLButtonElement>["form"];
}

export function Button({
  children,
  variant = "secondary",
  block,
  type = "button",
  busy,
  disabled,
  ...rest
}: Props) {
  const cls = [styles.btn, styles[variant], block ? styles.block : ""].join(" ");
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
