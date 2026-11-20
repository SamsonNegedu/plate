import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthProvider } from "@/app/auth";
import { DatabaseProvider } from "@/db/context";
import { PlateDB } from "@/db/schema";
import { SignupPage } from "./SignupPage";

let db: PlateDB;
let n = 0;
const calls: { url: string; body: unknown }[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CODES = ["ABCDE-FGHJK", "MNPQR-STVWX"];

function stubServer(signup: () => Response) {
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const url = new URL(req.url).pathname;
    const text = req.method === "POST" ? await req.clone().text() : "";
    calls.push({ url, body: text ? JSON.parse(text) : undefined });
    if (url.endsWith("/auth/challenge"))
      return json(200, {
        salt: "0".repeat(32),
        bits: 0,
        expires_at: 9e9,
        signature: "a".repeat(64),
      });
    if (url.endsWith("/auth/signup")) return signup();
    if (url.endsWith("/auth/recovery-codes/ack")) return new Response(null, { status: 204 });
    if (url.endsWith("/auth/me")) return json(401, { code: "unauthorized", detail: "no" });
    return json(404, { code: "not_found" });
  });
}

function mount() {
  const router = createMemoryRouter(
    [
      { path: "/signup", element: <SignupPage /> },
      { path: "/today", element: <p>today</p> },
    ],
    {
      initialEntries: ["/signup"],
    },
  );
  render(
    <DatabaseProvider db={db}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </DatabaseProvider>,
  );
}

beforeEach(() => {
  db = new PlateDB(`signup-test-${++n}`);
  calls.length = 0;
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await new Promise((r) => setTimeout(r, 0));
  db.close();
  await db.delete();
});

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, password: string) {
  await user.type(await screen.findByLabelText("Username"), name);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("signup", () => {
  test("solves the challenge, posts it, and shows the codes before continuing", async () => {
    stubServer(() => json(200, { user: { id: "u1", username: "kim" }, recovery_codes: CODES }));
    mount();
    const user = userEvent.setup();
    await fill(user, "kim", "a long passphrase here");

    expect(await screen.findByText("Save your recovery codes")).toBeInTheDocument();
    for (const c of CODES) expect(screen.getByText(c)).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith("/auth/signup"))?.body as Record<string, unknown>;
    expect(post).toMatchObject({ username: "kim", counter: 0, challenge: { bits: 0 } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(screen.getByLabelText("I have saved these codes"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/auth/recovery-codes/ack"))).toBe(true),
    );
  });

  test("leaving before the codes are saved asks first, and stops asking once they are", async () => {
    stubServer(() => json(200, { user: { id: "u1", username: "kim" }, recovery_codes: CODES }));
    mount();
    const user = userEvent.setup();
    await fill(user, "kim", "a long passphrase here");
    await screen.findByText("Save your recovery codes");

    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(true);
    await user.click(screen.getByLabelText("I have saved these codes"));
    expect(leave()).toBe(false);
  });

  test("a failed acknowledgement keeps the codes on screen", async () => {
    stubServer(() => json(200, { user: { id: "u1", username: "kim" }, recovery_codes: CODES }));
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
      const req = typeof input === "string" ? new Request(input, init) : input;
      if (new URL(req.url).pathname.endsWith("/auth/recovery-codes/ack"))
        return json(500, { code: "internal" });
      return base(input, init);
    });
    mount();
    const user = userEvent.setup();
    await fill(user, "kim", "a long passphrase here");
    await user.click(await screen.findByLabelText("I have saved these codes"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record that.");
    expect(screen.getByText(CODES[0] ?? "")).toBeInTheDocument();
  });

  test.each([
    ["username_taken", 409, "That username is taken."],
    ["signup_disabled", 403, "New accounts are turned off on this server."],
    ["rate_limited", 429, "Too many new accounts right now. Try again later."],
  ])("a %s answer is shown in plain words", async (code, status, text) => {
    stubServer(() => json(status, { code, detail: "x" }));
    mount();
    await fill(userEvent.setup(), "kim", "a long passphrase here");
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText("Save your recovery codes")).not.toBeInTheDocument();
  });

  test("a short password is stopped before any request", async () => {
    stubServer(() => json(500, {}));
    mount();
    await fill(userEvent.setup(), "kim", "short");
    await waitFor(() =>
      expect(
        screen.getByText("At least 12 characters.", { selector: '[role="alert"]' }),
      ).toBeInTheDocument(),
    );
    expect(calls).toHaveLength(1); // only the session check on start
  });
});
