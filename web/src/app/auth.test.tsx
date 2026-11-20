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
      {a.codesSaved === false ? " codes-unsaved" : ""}
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const me = (id: string, username: string) =>
  json(200, { user: { id, username, last_login_at: null }, recovery_codes_remaining: 8 });

describe("another account on the same device", () => {
  test("never inherits the previous account's local rows", async () => {
    await setMeta(db, META.userId, "u1");
    await db.meta.put({ key: "cursor", value: 41 });
    await db.entries.put({ id: "e1", name: "Sam's oats" } as never);
    mount(me("u2", "kim"));
    expect(await screen.findByText("authed")).toBeInTheDocument();
    expect(await db.entries.count()).toBe(0);
    expect(await db.meta.get("cursor")).toBeUndefined();
    expect((await db.meta.get(META.userId))?.value).toBe("u2");
  });

  test("keeps the local rows when the same account comes back", async () => {
    await setMeta(db, META.userId, "u1");
    await db.entries.put({ id: "e1", name: "Sam's oats" } as never);
    mount(me("u1", "sam"));
    expect(await screen.findByText("authed")).toBeInTheDocument();
    expect(await db.entries.count()).toBe(1);
  });

  test("a device that never signed in keeps its rows for the first account", async () => {
    await db.entries.put({ id: "e1", name: "Logged before signing in" } as never);
    mount(me("u1", "sam"));
    expect(await screen.findByText("authed")).toBeInTheDocument();
    expect(await db.entries.count()).toBe(1);
  });
});

describe("recovery codes status", () => {
  test("an account that has not confirmed its codes is reported as such", async () => {
    mount(
      json(200, {
        user: { id: "u1", username: "sam", last_login_at: null },
        recovery_codes_remaining: 8,
        recovery_codes_saved: false,
      }),
    );
    expect(await screen.findByText("authed codes-unsaved")).toBeInTheDocument();
  });

  test("a confirmed account shows nothing", async () => {
    mount(
      json(200, {
        user: { id: "u1", username: "sam", last_login_at: null },
        recovery_codes_remaining: 8,
        recovery_codes_saved: true,
      }),
    );
    expect(await screen.findByText("authed")).toBeInTheDocument();
  });
});
