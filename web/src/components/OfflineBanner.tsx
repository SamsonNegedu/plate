import { copy } from "@/lib/copy";

export function OfflineBanner({ notVerified }: { notVerified?: boolean }) {
  return (
    <p
      className="mb-3 rounded-ctl border border-amber bg-surface px-3 py-2.5 text-meta text-ink-2"
      role="status"
    >
      <strong className="font-semibold text-ink">
        {notVerified ? copy.offline.notVerified : "Offline"}
      </strong>{" "}
      {copy.offline.banner}
    </p>
  );
}
