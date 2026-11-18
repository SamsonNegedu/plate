import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

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

const variants = {
  secondary: "border-line bg-surface text-ink enabled:hover:border-ink-3",
  primary: "border-transparent bg-accent text-on-accent enabled:hover:bg-accent-2",
  ghost: "border-transparent bg-transparent text-ink-2 enabled:hover:text-ink",
  danger: "border-line bg-surface text-red enabled:hover:border-ink-3",
};

export function Button({
  children,
  variant = "secondary",
  block,
  type = "button",
  busy,
  disabled,
  ...rest
}: Props) {
  const cls = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-ctl border px-4 text-body leading-heading font-medium whitespace-nowrap disabled:cursor-default disabled:opacity-55",
    variants[variant],
    block && "w-full",
  );
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
