import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useSyncStore } from "@/app/sync";
import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { api } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { buildDiagnostics, copyText } from "./diagnostics";
import { useInstall } from "./install";
import { cls } from "./ui";

interface About {
  version: string;
  attributions: string[];
  catalog: { dataset_version: string; rows: number };
}

export function AboutPanel() {
  const db = useDb();
  const toast = useUi((s) => s.toast);
  const status = useStore(useSyncStore());
  const install = useInstall();
  const [about, setAbout] = useState<About | null>(null);
  const [storage, setStorage] = useState<{
    used: number;
    quota: number;
    persisted: boolean;
  } | null>(null);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .GET("/about")
      .then((r) => alive && r.data && setAbout(r.data as About))
      .catch(() => undefined);
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (alive && est) setStorage({ used: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const diagnostics = async () => {
    const text = await buildDiagnostics(db, status, storage);
    await copyText(text);
    toast({ message: "Diagnostics copied" });
  };

  const version = about?.version ?? "1.0.0";

  return (
    <>
      <section className={cls.section} aria-labelledby="storage-h">
        <h2 id="storage-h">Storage</h2>
        <p className={cls.muted}>
          Your log syncs to your other devices and stays available offline.
        </p>
        <div className={cls.actions}>
          {install.canPrompt ? (
            <Button onClick={() => void install.prompt()}>Install the app</Button>
          ) : null}
          {install.ios ? (
            <Button onClick={() => setIosHelp((v) => !v)}>Add to Home Screen</Button>
          ) : null}
        </div>
        {iosHelp ? (
          <p className={cls.muted}>In Safari, tap Share, then Add to Home Screen.</p>
        ) : null}
      </section>

      <section className={cls.section} aria-labelledby="about-h">
        <h2 id="about-h">About</h2>
        <dl className={cls.facts}>
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
          {about?.catalog.dataset_version ? (
            <div>
              <dt>Product catalog</dt>
              <dd>{`${about.catalog.dataset_version} · ${about.catalog.rows.toLocaleString("en-GB")} products`}</dd>
            </div>
          ) : null}
        </dl>
        {(about?.attributions ?? []).map((a) => (
          <p key={a} className={cls.attr}>
            {a}
          </p>
        ))}
        {!about ? (
          <p className={cls.attr}>
            Food data from Open Food Facts (ODbL), the Bundeslebensmittelschlüssel (CC BY 4.0), the
            FAO/INFOODS West African food table and USDA FoodData Central. Connect to see the full
            credits.
          </p>
        ) : null}
        <p className={cls.attr}>
          Plate has no analytics and no trackers. Your log stays on your own server and this device.
        </p>
        <div className={cls.actions}>
          <Button onClick={() => void diagnostics()}>Copy diagnostics</Button>
        </div>
      </section>
    </>
  );
}
