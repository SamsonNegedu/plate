import {
  createContext,
  type ReactNode,
  useCallback,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDb } from "@/db/context";
import { getMeta, META, setMeta } from "@/db/meta";
import { ApiError, api, toApiError } from "@/lib/api";
import { AccessExpired, NetworkError } from "@/sync/errors";

export type AuthStatus = "loading" | "authed" | "anon" | "access";

/**
 * One state, so an email can never exist without a session and "offline" only exists where it means something:
 * authed + offline is a device that was signed in earlier and could not reach the server to confirm; anon + offline is
 * a sign-in screen shown because the network is down.
 */
type AuthState =
  | { status: "loading" }
  | { status: "authed"; email: string | null; offline: boolean }
  | { status: "anon"; offline: boolean }
  | { status: "access" };

const SIGNED_OUT: AuthState = { status: "anon", offline: false };

interface AuthValue {
  status: AuthStatus;
  email: string | null;
  /** Authenticated earlier on this device, but the server could not be reached to confirm. */
  offline: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** The server said the session is gone. Local data stays; the user signs in again. */
  expire(): void;
  recheck(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const recheck = useCallback(async () => {
    try {
      const res = await api.GET("/auth/me");
      if (res.data) {
        await setMeta(db, META.userId, res.data.user.id);
        await setMeta(db, META.email, res.data.user.email);
        setState({ status: "authed", email: res.data.user.email, offline: false });
        return;
      }
      if (res.response.status === 401) {
        setState(SIGNED_OUT);
        return;
      }
      throw toApiError(res.response.status, res.error);
    } catch (err) {
      const cachedUser = await getMeta<string>(db, META.userId);
      if (err instanceof AccessExpired) {
        setState({ status: "access" });
      } else if ((err instanceof NetworkError || err instanceof ApiError) && cachedUser) {
        // Only a 401 ends the session. A 429 or 5xx means the server could not confirm it right now.
        const email = (await getMeta<string>(db, META.email)) ?? null;
        setState({ status: "authed", email, offline: true });
      } else {
        setState({ status: "anon", offline: err instanceof NetworkError });
      }
    }
  }, [db]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the session check is an external fetch; state is set after the await
    void recheck();
  }, [recheck]);

  const login = useCallback(
    async (emailIn: string, password: string) => {
      const res = await api.POST("/auth/login", { body: { email: emailIn, password } });
      if (!res.data) throw toApiError(res.response.status, res.error);
      await recheck();
    },
    [recheck],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST("/auth/logout");
    } catch {
      // Signing out locally still works when the server is unreachable.
    }
    setState(SIGNED_OUT);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status: state.status,
      email: state.status === "authed" ? state.email : null,
      offline: (state.status === "authed" || state.status === "anon") && state.offline,
      login,
      logout,
      expire: () => setState(SIGNED_OUT),
      recheck,
    }),
    [state, login, logout, recheck],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuth(): AuthValue {
  const v = use(Ctx);
  if (!v) throw new Error("useAuth needs an AuthProvider");
  return v;
}

export { ApiError };
