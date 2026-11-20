import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

interface Props {
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  id?: string;
  /** For a select with no visible label of its own. */
  label?: string;
  invalid?: boolean;
  /** Outlines the control, to show it holds the current pick. */
  active?: boolean;
  /** Classes for the wrapper, such as a width. */
  className?: string;
}

function tone(invalid: boolean | undefined, active: boolean | undefined): string {
  if (invalid) return "border-red";
  return active ? "border-ink font-medium text-ink" : "border-line";
}

/** A native select with its own chevron, so the arrow sits inside the control with room to breathe instead of on the edge. */
export function Select({
  value,
  onChange,
  children,
  id,
  label,
  invalid,
  active,
  className,
}: Props) {
  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onChange={onChange}
        className={cn(
          "min-h-11 w-full appearance-none rounded-ctl border bg-surface pr-10 pl-3 text-input",
          tone(invalid, active),
        )}
      >
        {children}
      </select>
      <Icon
        name="down"
        size={18}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-2"
      />
    </div>
  );
}
