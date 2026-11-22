import { useState } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

/** A bottom sheet that asks before something is lost. The confirm button sits in the thumb zone; Cancel is the easy way out. */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={title}
      description={body}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="danger"
            block
            busy={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirm()).finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </Button>
          <Button block onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <span className="sr-only">{body}</span>
    </Sheet>
  );
}
