import { cn } from "@/lib/cn";

/** The class vocabulary shared by the settings panels. Panels are plain markup, so the patterns live here once. */
export const cls = {
  page: "grid gap-5.5 pb-2",
  title: "mt-1 text-title font-semibold",
  section:
    "grid gap-3 [&>h2]:border-b-[1.5px] [&>h2]:border-ink [&>h2]:pb-1.5 [&>h2]:text-section [&>h2]:font-semibold",
  form: "grid gap-3.5",
  three: "grid grid-cols-3 gap-2",
  row: "flex flex-wrap items-center gap-2.5",
  hint: "text-meta text-ink-2",
  dirty: "text-meta text-amber",
  muted: "text-label text-ink-2",
  error: "text-label text-red",
  facts:
    "grid gap-1 [&>div]:flex [&>div]:min-h-8 [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-line [&>div]:text-label [&_dt]:text-ink-2 [&_dd]:text-right [&_dd]:font-medium",
  item: "flex min-h-13 items-center gap-2 border-b border-line [&>span]:min-w-0 [&>span]:flex-1 [&_strong]:block [&_strong]:truncate [&_strong]:text-body [&_strong]:font-medium [&_small]:block [&_small]:truncate [&_small]:text-meta [&_small]:text-ink-2",
  actions: "flex flex-wrap gap-2",
  advanced:
    "text-label open:grid open:gap-2 [&_summary]:flex [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:items-center [&_summary]:text-ink-2",
  attr: "text-meta leading-normal text-ink-2",
  pre: "overflow-x-auto whitespace-pre-wrap rounded-ctl border border-line bg-surface-2 p-2.5 text-micro",
};

export const panel = (warn = false) =>
  cn(
    "grid gap-2.5 rounded-card border bg-surface p-3.5 [&_h3]:text-body [&_h3]:font-semibold",
    warn ? "border-red" : "border-line",
  );

export const smallBtn = (danger = false) =>
  cn(
    "min-h-11 rounded-ctl border border-line bg-surface px-3 text-label",
    danger ? "text-red" : "text-ink",
  );
