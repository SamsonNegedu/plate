import { createContext, type ReactNode, use, useMemo } from "react";
import { PlateDB } from "./schema";

const Ctx = createContext<PlateDB | null>(null);

let singleton: PlateDB | null = null;
export function appDb(): PlateDB {
  singleton ??= new PlateDB();
  return singleton;
}

export function DatabaseProvider({ db, children }: { db?: PlateDB; children: ReactNode }) {
  const value = useMemo(() => db ?? appDb(), [db]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function useDb(): PlateDB {
  const db = use(Ctx);
  if (!db) throw new Error("useDb needs a DatabaseProvider");
  return db;
}
