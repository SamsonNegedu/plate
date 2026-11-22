import { lazy, type ReactElement, Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPage } from "@/features/auth/ResetPage";
import { SignupPage } from "@/features/auth/SignupPage";
import { TodayPage } from "@/features/today/TodayPage";
import { AppShell } from "./AppShell";
import { AuthGate } from "./AuthGate";

const ScanPage = lazy(() => import("@/features/scan/ScanPage"));
const HealthPage = lazy(() => import("@/features/health/HealthPage"));
const RecipesPage = lazy(() => import("@/features/recipes/RecipesPage"));
const RecipePage = lazy(() => import("@/features/recipes/RecipePage"));
const HistoryPage = lazy(() => import("@/features/history/HistoryPage"));
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const SettingsSection = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsSection })),
);

const lazyRoute = (el: ReactElement) => (
  <Suspense fallback={<p role="status">Loading</p>}>{el}</Suspense>
);

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/reset", element: <ResetPage /> },
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
          { path: "/recipes", element: lazyRoute(<RecipesPage />) },
          { path: "/recipes/:id", element: lazyRoute(<RecipePage />) },
          { path: "/health", element: lazyRoute(<HealthPage />) },
          { path: "/health/:tab", element: lazyRoute(<HealthPage />) },
          { path: "/history", element: lazyRoute(<HistoryPage />) },
          { path: "/settings", element: lazyRoute(<SettingsPage />) },
          { path: "/settings/:section", element: lazyRoute(<SettingsSection />) },
          { path: "*", element: <Navigate to="/today" replace /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
