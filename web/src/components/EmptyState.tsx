import type { ReactNode } from "react";

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
    <div className="pt-7 pb-2 text-center">
      <p className="text-section font-semibold">{title}</p>
      {body ? <p className="mt-1 text-body text-ink-2">{body}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
