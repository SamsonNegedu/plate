import { useState } from "react";
import { Button } from "@/components/Button";
import { useInstall } from "@/features/settings/install";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";

const KEY = "plate.install.dismissed";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return at > 0 && Date.now() - at < THIRTY_DAYS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Private mode: the hint simply appears again next session.
  }
}

/** Offered after the app has been useful, not on first open: installing improves offline access on a phone. */
export function InstallNudge() {
  const count = useUi((s) => s.logCount);
  const install = useInstall();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (hidden || count < 3 || (!install.canPrompt && !install.ios)) return null;

  return (
    <aside className="mt-3 grid gap-2 rounded-card border border-line bg-surface p-3">
      <div>
        <p className="text-body font-semibold">{copy.install.title}</p>
        <p className="text-meta text-ink-2">{install.ios ? copy.install.ios : copy.install.body}</p>
      </div>
      <div className={install.canPrompt ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
        <Button
          onClick={() => {
            rememberDismissal();
            setHidden(true);
          }}
        >
          {copy.install.notNow}
        </Button>
        {install.canPrompt ? (
          <Button
            onClick={() => {
              void install.prompt();
              setHidden(true);
            }}
          >
            {copy.install.action}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
