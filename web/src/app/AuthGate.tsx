import { Navigate, Outlet, useLocation } from "react-router";
import { Button } from "@/components/Button";
import { copy } from "@/lib/copy";
import { useAuth } from "./auth";

/** Protected routes. A 401 sends the user to login without touching local data; an offline start keeps the app usable. */
export function AuthGate() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading")
    return (
      <p className="px-4 py-16 text-center text-ink-2" role="status">
        {copy.common.loading}
      </p>
    );
  if (status === "anon")
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === "access") {
    return (
      <main className="mx-auto max-w-[560px] px-4 py-16">
        <h1 className="mb-2 text-title font-semibold">{copy.access.title}</h1>
        <p className="mb-6 text-ink-2">{copy.access.body}</p>
        <Button variant="primary" onClick={() => window.location.assign(window.location.origin)}>
          {copy.access.action}
        </Button>
      </main>
    );
  }
  return <Outlet />;
}
