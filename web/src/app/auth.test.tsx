import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseProvider } from "@/db/context";
import { META, setMeta } from "@/db/meta";
import { PlateDB } from "@/db/schema";
import { AuthProvider, useAuth } from "./auth";

let db: PlateDB;
let n = 0;

beforeEach(() => {
  db = new PlateDB(`auth-test-${++n}`);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await new Promise((r) => setTimeout(r, 0));
  db.close();
  await db.delete();
});

function Probe() {
  const a = useAuth();
  return (
    <p>
      {a.status}
      {a.offline ? " unverified" : ""}
    </p>
  );
}

const problem = (status: number) =>
  new Response(JSON.stringify({ code: "rate_limited", detail: "Slow down." }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

function mount(res: Response | Error) {
  vi.stubGlobal("fetch", () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)));
  render(
    <DatabaseProvider db={db}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </DatabaseProvider>,
  );
}

describe("auth check on start", () => {
  test("a 401 means signed out", async () => {
    await setMeta(db, META.userId, "u1");
    mount(problem(401));
    expect(await screen.findByText("anon")).toBeInTheDocument();
  });

  test.each([429, 500, 502])(
    "a %i keeps a known device signed in, marked unverified",
    async (status) => {
      await setMeta(db, META.userId, "u1");
      mount(problem(status));
      await waitFor(() => expect(screen.getByText("authed unverified")).toBeInTheDocument());
    },
  );

  test("an unreachable server keeps a known device signed in, marked unverified", async () => {
    await setMeta(db, META.userId, "u1");
    mount(new TypeError("Failed to fetch"));
    await waitFor(() => expect(screen.getByText("authed unverified")).toBeInTheDocument());
  });

  test("a server error on a device that never signed in shows the sign-in screen", async () => {
    mount(problem(500));
    expect(await screen.findByText("anon")).toBeInTheDocument();
  });
});
