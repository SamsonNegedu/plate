import { type ReactNode, useMemo } from "react";
import { RouterProvider } from "react-router";
import { DatabaseProvider } from "@/db/context";
import type { PlateDB } from "@/db/schema";
import { AuthProvider } from "./auth";
import { ErrorBoundary } from "./ErrorBoundary";
import { createRouter } from "./router";
import { SyncProvider } from "./sync";
import { ThemeSync } from "./theme";

function Providers({ db, children }: { db?: PlateDB; children: ReactNode }) {
  return (
    <ErrorBoundary>
      <DatabaseProvider {...(db ? { db } : {})}>
        <AuthProvider>
          <SyncProvider>
            <ThemeSync />
            {children}
          </SyncProvider>
        </AuthProvider>
      </DatabaseProvider>
    </ErrorBoundary>
  );
}

export function App() {
  const router = useMemo(() => createRouter(), []);
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
