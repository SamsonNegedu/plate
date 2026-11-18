import { lazy, type ReactElement, Suspense } from "react";
import { createBrowserRouter, createMemoryRouter, Navigate, type RouteObject } from "react-router";
import { LoginPage } from "@/features/auth/LoginPage";
import { TodayPage } from "@/features/today/TodayPage";
import { AppShell } from "./AppShell";
import { AuthGate } from "./AuthGate";

const ScanPage = lazy(() => import("@/features/scan/ScanPage"));
const HistoryPage = lazy(() => import("@/features/history/HistoryPage"));
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

const lazyRoute = (el: ReactElement) => (
  <Suspense fallback={<p role="status">Loading</p>}>{el}</Suspense>
);

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/today" replace /> },
          { path: "/today", element: <TodayPage /> },
          { path: "/today/:date", element: <TodayPage /> },
          { path: "/scan", element: lazyRoute(<ScanPage />) },
          { path: "/history", element: lazyRoute(<HistoryPage />) },
          { path: "/settings", element: lazyRoute(<SettingsPage />) },
          { path: "*", element: <Navigate to="/today" replace /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
export const createTestRouter = (path: string) =>
  createMemoryRouter(routes, { initialEntries: [path] });
